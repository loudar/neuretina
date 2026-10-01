import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  ChoiceAnswer,
  ChoiceQuestion,
  DecisionModel,
} from "../../capabilities/decision/DecisionModel.ts";

/** Metadata shipped with the ONNX export (`decision.json`). */
interface LayaManifest {
  layout: string;
  encoder: string;
  max_len: number;
  head_max_len: number;
  special_tokens: { cls: number; sep: number; mask: number; pad: number; mask_text: string };
  inputs: string[];
  outputs: string[];
  min_markers: number;
}

interface LayaCalibration {
  temperature?: number | number[];
  temperature_by_options?: Record<string, number>;
}

export interface LayaOnnxOptions {
  /** Directory holding model-fp16.onnx, decision.json, tokenizer files. */
  modelDir: string;
  /** Pull the weights on first use when they are missing. */
  allowDownload?: boolean;
  /** Laya degrades past ~20 options; a coarse split is the caller's job. */
  maxOptions?: number;
}

/** The tensors the graph expects, once a session exists. */
interface LayaSession {
  run(inputs: Record<string, unknown>): Promise<Record<string, { data: ArrayLike<number>; dims: number[] }>>;
}

interface LayaTokenizer {
  (text: string, options?: Record<string, unknown>): Promise<{
    input_ids: { data: ArrayLike<number>; dims: number[] };
    attention_mask: { data: ArrayLike<number>; dims: number[] };
  }>;
}

const LAYA_FILES: Array<{ url: string; path: string }> = [
  { url: "https://huggingface.co/ollaya-dev/laya/resolve/main/multilingual/model-fp16.onnx", path: "model-fp16.onnx" },
  { url: "https://huggingface.co/ollaya-dev/laya/resolve/main/multilingual/decision.json", path: "decision.json" },
  { url: "https://huggingface.co/ollaya-dev/laya/resolve/main/multilingual/calibration.json", path: "calibration.json" },
  { url: "https://huggingface.co/jhu-clsp/mmBERT-base/resolve/main/tokenizer.json", path: "tokenizer.json" },
  { url: "https://huggingface.co/jhu-clsp/mmBERT-base/resolve/main/tokenizer_config.json", path: "tokenizer_config.json" },
  { url: "https://huggingface.co/jhu-clsp/mmBERT-base/resolve/main/special_tokens_map.json", path: "special_tokens_map.json" },
];

/**
 * In-process Laya decision model (multilingual, ONNX). Everything is loaded
 * lazily on first use: the files (downloaded on demand when allowed), the
 * tokenizer and the ONNX runtime. Any failure marks the model unavailable so
 * callers fall back to the LLM categorizer instead of crashing.
 */
export class LayaOnnxDecisionModel implements DecisionModel {
  readonly name = "laya";
  private loading: Promise<LayaHandle | null> | null = null;

  constructor(private readonly options: LayaOnnxOptions) {}

  async available(): Promise<boolean> {
    return (await this.handle()) !== null;
  }

  async choose(state: string, question: ChoiceQuestion): Promise<ChoiceAnswer> {
    const handle = await this.handle();
    if (!handle) throw new Error("Laya model is not available");
    return handle.choose(state, question);
  }

  private handle(): Promise<LayaHandle | null> {
    if (!this.loading) this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<LayaHandle | null> {
    try {
      const manifest = await this.readManifest();
      if (manifest.layout !== "laya-markers-v1") return null;
      if (this.options.allowDownload) await this.ensureFiles();
      const [ort, transformers] = await Promise.all([
        importOptional("onnxruntime-node"),
        importOptional("@huggingface/transformers"),
      ]);
      if (!ort?.InferenceSession || !transformers?.AutoTokenizer) return null;

      const tokenizer = (await transformers.AutoTokenizer.from_pretrained(
        this.options.modelDir,
      )) as unknown as LayaTokenizer;
      const session = (await ort.InferenceSession.create(
        join(this.options.modelDir, "model-fp16.onnx"),
      )) as unknown as LayaSession;
      const calibration = await this.readCalibration();
      return new LayaHandle(ort, session, tokenizer, manifest, calibration, this.options.maxOptions ?? 20);
    } catch {
      return null;
    }
  }

  private async readManifest(): Promise<LayaManifest> {
    const raw = await readFile(join(this.options.modelDir, "decision.json"), "utf8");
    return JSON.parse(raw) as LayaManifest;
  }

  private async readCalibration(): Promise<LayaCalibration> {
    try {
      const raw = await readFile(join(this.options.modelDir, "calibration.json"), "utf8");
      return JSON.parse(raw) as LayaCalibration;
    } catch {
      return {};
    }
  }

  private async ensureFiles(): Promise<void> {
    for (const file of LAYA_FILES) {
      const target = join(this.options.modelDir, file.path);
      if (await Bun.file(target).exists()) continue;
      const response = await fetch(file.url, { redirect: "follow" });
      if (!response.ok) throw new Error(`${file.path}: ${response.status}`);
      await Bun.write(target, response);
    }
  }
}

/** Best-effort dynamic import: optional native/WASM dependencies. */
async function importOptional(specifier: string): Promise<Record<string, any> | null> {
  try {
    return (await import(specifier)) as Record<string, any>;
  } catch {
    return null;
  }
}

/** One loaded model: markers-v1 input layout, per-option scoring, softmax. */
class LayaHandle {
  constructor(
    private readonly ort: Record<string, any>,
    private readonly session: LayaSession,
    private readonly tokenizer: LayaTokenizer,
    private readonly manifest: LayaManifest,
    private readonly calibration: LayaCalibration,
    private readonly maxOptions: number,
  ) {}

  async choose(state: string, question: ChoiceQuestion): Promise<ChoiceAnswer> {
    const keys = Object.keys(question.options);
    if (keys.length < 2) throw new Error("Laya needs at least two options");
    if (keys.length > this.maxOptions) {
      throw new Error(`Laya supports at most ${this.maxOptions} options (got ${keys.length})`);
    }

    // Markers layout: state, instructions, then one line per option ending in
    // the mask token; the mask positions are the option scores.
    const lines = [state.trim(), question.instructions.trim()];
    for (const key of keys) {
      lines.push(`${key}: ${question.options[key] ?? ""} ${this.manifest.special_tokens.mask_text}`);
    }
    const encoded = await this.tokenizer(lines.join("\n"), { padding: false, truncation: true });
    const ids = Array.from(encoded.input_ids.data as ArrayLike<number>);
    const attention = Array.from(encoded.attention_mask.data as ArrayLike<number>);
    const maskId = this.manifest.special_tokens.mask;

    const markerPos: number[] = [];
    ids.forEach((id, index) => {
      // Tokenizer ids arrive as BigInt; the manifest stores plain numbers.
      if (Number(id) === maskId) markerPos.push(index);
    });
    if (markerPos.length < keys.length) {
      throw new Error("Laya tokenizer did not keep the option markers");
    }

    const markers = markerPos.slice(0, keys.length);

    const outputs = await this.session.run({
      input_ids: this.tensor("int64", ids, [1, ids.length]),
      attention_mask: this.tensor("int64", attention, [1, attention.length]),
      marker_pos: this.tensor("int64", markers, [1, markers.length]),
      marker_mask: this.tensor("bool", markers.map(() => 1), [1, markers.length]),
      qtype: this.tensor("int64", [0], [1]),
    });
    const logits = outputs.logits;
    if (!logits) throw new Error("Laya session returned no logits");

    // One score per marker (extra class axes collapse to their first entry).
    const scores = keys.map((_, index) => Number(logits.data[index] ?? 0));
    const temperature = this.temperatureFor(keys.length);
    const probabilities = softmax(scores, temperature);
    const distribution: Record<string, number> = {};
    let best = keys[0]!;
    let bestProbability = -1;
    keys.forEach((key, index) => {
      const value = probabilities[index] ?? 0;
      distribution[key] = value;
      if (value > bestProbability) {
        bestProbability = value;
        best = key;
      }
    });

    return { choice: best, confidence: Math.max(0, bestProbability), probabilities: distribution };
  }

  private tensor(type: string, values: number[], dims: number[]): unknown {
    const data =
      type === "bool"
        ? Uint8Array.from(values)
        : BigInt64Array.from(values, (value) => BigInt(value));
    return new this.ort.Tensor(type, data, dims);
  }

  private temperatureFor(optionCount: number): number {
    const byOptions = this.calibration.temperature_by_options?.[String(optionCount)];
    if (typeof byOptions === "number" && byOptions > 0) return byOptions;
    const temperature = this.calibration.temperature;
    if (Array.isArray(temperature) && temperature[0] && temperature[0] > 0) return temperature[0];
    if (typeof temperature === "number" && temperature > 0) return temperature;
    return 1;
  }
}

function softmax(scores: number[], temperature: number): number[] {
  const scaled = scores.map((score) => score / temperature);
  const max = Math.max(...scaled);
  const exps = scaled.map((score) => Math.exp(score - max));
  const sum = exps.reduce((total, value) => total + value, 0) || 1;
  return exps.map((value) => value / sum);
}


