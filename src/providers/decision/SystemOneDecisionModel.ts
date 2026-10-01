import type {
  ChoiceAnswer,
  ChoiceQuestion,
  DecisionModel,
} from "../../capabilities/decision/DecisionModel.ts";
import { errorMessage } from "../../core/errors.ts";

export interface SystemOneDecisionModelOptions {
  /** Registry name / connection id. */
  id: string;
  /** Display provider, e.g. "TypeSafe" or "Cloudflare". */
  provider: string;
  model: string;
  /** Full request URL the SystemOne body is posted to. */
  endpoint: string;
  apiKey?: string;
  timeoutMs?: number;
}

/** One answer of a Jev/SystemOne response. */
interface SystemOneAnswer {
  type?: string;
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
  noul?: number;
}

interface SystemOneResponse {
  model?: string;
  answers?: Record<string, SystemOneAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  /** Workers AI REST API wraps the payload in `result`. */
  result?: SystemOneResponse;
}

/**
 * Hosted decision model speaking the Jev/SystemOne API: a state plus typed
 * questions in, calibrated probabilities out. Clef is fully compatible with
 * Jev, so one provider serves both; the connection only carries the endpoint,
 * model selector and credentials.
 */
export class SystemOneDecisionModel implements DecisionModel {
  readonly name: string;
  /** "{provider} - {model}", for settings and status messages. */
  readonly label: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: SystemOneDecisionModelOptions) {
    this.name = options.id;
    this.label = `${options.provider} - ${options.model}`;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  /** Configured is enough; a network probe would run before every decision. */
  async available(): Promise<boolean> {
    return Boolean(this.options.endpoint && this.options.model);
  }

  async choose(state: string, question: ChoiceQuestion): Promise<ChoiceAnswer> {
    const payload = await this.request({
      model: this.options.model,
      state,
      questions: {
        choice: {
          type: "choice",
          instructions: question.instructions,
          criteria: question.options,
        },
      },
    });

    const answer = payload.answers?.choice;
    if (!answer || typeof answer.choice !== "string" || !answer.choice) {
      throw new Error("The decision model returned no choice");
    }

    const probabilities = numericRecord(answer.probabilities);
    const confidence =
      typeof answer.confidence === "number"
        ? clamp01(answer.confidence)
        : distributionConfidence(probabilities, answer.choice);

    return { choice: answer.choice, confidence, probabilities };
  }

  /** Live pre-flight: one cheap yes/no question against the endpoint. */
  async verify(): Promise<string> {
    const payload = await this.request({
      model: this.options.model,
      state: "Connectivity test from Neuretina.",
      questions: {
        verify: { type: "noul", instructions: "Is this a connectivity test?" },
      },
    });

    const value = payload.answers?.verify?.noul;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("The endpoint did not return a noul answer");
    }
    return `replied (test probability ${clamp01(value).toFixed(2)})`;
  }

  private async request(body: Record<string, unknown>): Promise<SystemOneResponse> {
    let response: Response;
    try {
      response = await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(this.options.apiKey
            ? { authorization: `Bearer ${this.options.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error(`Request to ${hostOf(this.options.endpoint)} failed: ${errorMessage(error)}`);
    }

    const text = await response.text();
    if (!response.ok) {
      const detail = summarize(text);
      throw new Error(
        `${response.status} ${response.statusText} from ${hostOf(this.options.endpoint)}${
          detail ? `: ${detail}` : ""
        }`,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("The decision model returned invalid JSON");
    }

    const payload = unwrap(parsed);
    if (!payload) throw new Error("The decision model returned an unexpected body");
    return payload;
  }
}

/** Workers AI wraps responses in `result`; direct SystemOne servers do not. */
function unwrap(value: unknown): SystemOneResponse | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const result = record.result;
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return result as SystemOneResponse;
  }
  return record as SystemOneResponse;
}

function numericRecord(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, number] => typeof entry[1] === "number",
  );
  return Object.fromEntries(entries);
}

/**
 * TypeSafe's confidence definition when a server reports probabilities but no
 * confidence: the top probability normalized against uniform chance,
 * (top - 1/k) / (1 - 1/k).
 */
function distributionConfidence(
  probabilities: Record<string, number>,
  choice: string,
): number {
  const values = Object.values(probabilities);
  if (values.length === 0) return 0;
  const top = probabilities[choice] ?? Math.max(...values);
  if (values.length <= 1) return clamp01(top);
  return clamp01((top - 1 / values.length) / (1 - 1 / values.length));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** First line of an error body, for compact messages. */
function summarize(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}
