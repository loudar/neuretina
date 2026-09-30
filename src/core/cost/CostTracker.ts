import type { FinanceUsage } from "../../capabilities/finance/FinanceProvider.ts";
import type { LlmUsage } from "../../capabilities/llm/LlmProvider.ts";

export interface CostPricing {
  /** USD per 1M input tokens; 0 = unknown (tokens are recorded but unpriced). */
  llmInputPerMillion: number;
  /** USD per 1M output tokens; 0 = unknown. */
  llmOutputPerMillion: number;
  /** USD per Perplexity search request; 0 = unknown. */
  perplexitySearchPerRequest: number;
}

export interface CostLine {
  /** Workflow step the cost belongs to, e.g. "Research". */
  step: string;
  /** Provider that billed it, e.g. "llm" or "perplexity". */
  provider: string;
  /** Human-readable usage, e.g. "2 calls · 12,340 in / 567 out tokens". */
  detail: string;
  /** USD when a price is known; absent when the usage could not be priced. */
  usd?: number;
}

export interface CostReport {
  totalUsd: number;
  /** False when at least one line has no known price. */
  complete: boolean;
  lines: CostLine[];
}

export const ZERO_PRICING: CostPricing = {
  llmInputPerMillion: 0,
  llmOutputPerMillion: 0,
  perplexitySearchPerRequest: 0,
};

interface Accumulator {
  step: string;
  provider: string;
  calls: number;
  requests: number;
  lookups: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  priced: boolean;
}

/**
 * Per-run cost accumulator. Every workflow step reports its LLM usage, paid
 * searches and finance lookups here; the runner stores the resulting report on
 * the run record.
 */
export class CostTracker {
  private readonly accumulators = new Map<string, Accumulator>();

  constructor(private readonly pricing: CostPricing = ZERO_PRICING) {}

  addLlm(step: string, usage: LlmUsage, calls = 1): void {
    const entry = this.entry(step, "llm");
    entry.calls += calls;
    if (usage.inputTokens !== undefined) entry.inputTokens += usage.inputTokens;
    if (usage.outputTokens !== undefined) entry.outputTokens += usage.outputTokens;

    if (usage.costUsd !== undefined) {
      entry.usd += usage.costUsd;
      entry.priced = true;
      return;
    }
    if (this.pricing.llmInputPerMillion > 0 || this.pricing.llmOutputPerMillion > 0) {
      entry.usd += ((usage.inputTokens ?? 0) / 1_000_000) * this.pricing.llmInputPerMillion;
      entry.usd += ((usage.outputTokens ?? 0) / 1_000_000) * this.pricing.llmOutputPerMillion;
      entry.priced = true;
    }
  }

  addPerplexitySearch(step: string, requests: number): void {
    const entry = this.entry(step, "perplexity");
    entry.requests += requests;
    if (this.pricing.perplexitySearchPerRequest > 0) {
      entry.usd += requests * this.pricing.perplexitySearchPerRequest;
      entry.priced = true;
    }
  }

  addFinance(step: string, usage: FinanceUsage): void {
    const entry = this.entry(step, "perplexity");
    entry.lookups += 1;
    if (usage.inputTokens !== undefined) entry.inputTokens += usage.inputTokens;
    if (usage.outputTokens !== undefined) entry.outputTokens += usage.outputTokens;
    if (usage.costUsd !== undefined) {
      entry.usd += usage.costUsd;
      entry.priced = true;
    }
  }

  report(): CostReport {
    const lines = [...this.accumulators.values()].map(toLine);
    const totalUsd = round(lines.reduce((sum, line) => sum + (line.usd ?? 0), 0));
    return { totalUsd, complete: lines.every((line) => line.usd !== undefined), lines };
  }

  private entry(step: string, provider: string): Accumulator {
    const key = `${step}\u0000${provider}`;
    let entry = this.accumulators.get(key);
    if (!entry) {
      entry = {
        step,
        provider,
        calls: 0,
        requests: 0,
        lookups: 0,
        inputTokens: 0,
        outputTokens: 0,
        usd: 0,
        priced: false,
      };
      this.accumulators.set(key, entry);
    }
    return entry;
  }
}

function toLine(entry: Accumulator): CostLine {
  const parts: string[] = [];
  if (entry.calls > 0) parts.push(`${entry.calls} call${entry.calls === 1 ? "" : "s"}`);
  if (entry.requests > 0) {
    parts.push(`${entry.requests} search${entry.requests === 1 ? "" : "es"}`);
  }
  if (entry.lookups > 0) parts.push(`${entry.lookups} lookup${entry.lookups === 1 ? "" : "s"}`);
  if (entry.inputTokens > 0 || entry.outputTokens > 0) {
    parts.push(
      `${formatCount(entry.inputTokens)} in / ${formatCount(entry.outputTokens)} out tokens`,
    );
  }

  return {
    step: entry.step,
    provider: entry.provider,
    detail: parts.join(" · "),
    ...(entry.priced ? { usd: round(entry.usd) } : {}),
  };
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
