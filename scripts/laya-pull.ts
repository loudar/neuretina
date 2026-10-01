/**
 * Downloads the Laya multilingual decision model so the engine can run it
 * in-process for event tagging:
 *   - the ONNX graph + decision/calibration metadata (ollaya export),
 *   - the tokenizer shipped by the upstream checkpoint,
 *   - the upstream weights, stored under the sha256 name the graph references
 *     as external data.
 *
 * Usage: bun run laya:pull   (honors LAYA_MODEL_DIR)
 */
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const MODEL_DIR = process.env.LAYA_MODEL_DIR ?? "./data/models/laya";
const HF = "https://huggingface.co";
const UPSTREAM = `${HF}/convaiinnovations/laya-multilingual/resolve/main`;

const FILES: Array<{ url: string; path: string }> = [
  { url: `${HF}/ollaya-dev/laya/resolve/main/multilingual/model-fp16.onnx`, path: "model-fp16.onnx" },
  { url: `${HF}/ollaya-dev/laya/resolve/main/multilingual/decision.json`, path: "decision.json" },
  { url: `${HF}/ollaya-dev/laya/resolve/main/multilingual/calibration.json`, path: "calibration.json" },
  { url: `${UPSTREAM}/tokenizer/tokenizer.json`, path: "tokenizer.json" },
  { url: `${UPSTREAM}/tokenizer/tokenizer_config.json`, path: "tokenizer_config.json" },
];

async function download(url: string, target: string): Promise<void> {
  if (await Bun.file(target).exists()) {
    console.log(`ok   ${target.slice(MODEL_DIR.length + 1)}`);
    return;
  }
  process.stdout.write(`get  ${target.slice(MODEL_DIR.length + 1)} … `);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    console.log("failed");
    throw new Error(`${url}: ${response.status} ${response.statusText}`);
  }
  await Bun.write(target, response);
  const size = (await Bun.file(target).size) / (1024 * 1024);
  console.log(`${size.toFixed(1)} MB`);
}

mkdirSync(MODEL_DIR, { recursive: true });
for (const file of FILES) await download(file.url, join(MODEL_DIR, file.path));

// The graph references upstream weights by their sha256 as external data.
const graph = new TextDecoder("latin1").decode(
  await Bun.file(join(MODEL_DIR, "model-fp16.onnx")).arrayBuffer(),
);
const external = [...new Set(graph.match(/sha256-[0-9a-f]{64}/g) ?? [])];
if (external.length === 0) throw new Error("the graph references no external weights");

for (const name of external) {
  const target = join(MODEL_DIR, name);
  if (await Bun.file(target).exists()) {
    console.log(`ok   ${name}`);
    continue;
  }
  process.stdout.write(`get  weights (${name.slice(0, 15)}…) … `);
  const response = await fetch(`${UPSTREAM}/model.safetensors`, { redirect: "follow" });
  if (!response.ok) {
    console.log("failed");
    throw new Error(`weights: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const hash = `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
  if (hash !== name) {
    console.log("hash mismatch");
    throw new Error(`upstream weights are ${hash}, expected ${name}`);
  }
  await Bun.write(target, bytes);
  console.log(`${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB`);
}

console.log(`\nLaya model ready in ${MODEL_DIR}`);
