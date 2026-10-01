import type { FinanceUsage } from "../../capabilities/finance/FinanceProvider.ts";
import type { LlmUsage } from "../../capabilities/llm/LlmProvider.ts";

export interface CostLine {
  /** Workflow step the cost belongs to, e.g. "Research". */
  step: string;
  /** Provider that billed it, e.g. "llm" or "perplexity". */
  provider: string;
  /** Human-readable usage, e.g. "2 calls · 12,340 in / 567 out tokens". */
  detail: string;
  /** USD; unpriced usage is reported as 0. */
  usd: number;
}

export interface CostReport {
  totalUsd: number;
  /** False when at least one line has no provider-reported price. */
  complete: boolean;
  lines: CostLine[];
}

/** Search usage attributed to one provider on one step. */
export interface SearchUsage {
  /** Search requests that ran. */
  requests: number;
  /** Requests the provider left unpriced. */
  unpriced: number;
  /** Sum of the provider-reported costs. */
  costUsd: number;
}

/** Finance usage attributed to one provider on one step. */
export interface FinanceUsageSummary {
  /** Lookups that ran. */
  lookups: number;
  /** Lookups the provider left unpriced. */
  unpriced: number;
  inputTokens: number;
  outputTokens: number;
  /** Sum of the provider-reported costs. */
  costUsd: number;
}

interface Accumulator {
  step: string;
  provider: string;
  calls: number;
  requests: number;
  lookups: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
  /** Usage entries whose provider did not report a cost. */
  unpriced: number;
}

/**
 * Per-run cost accumulator. Every workflow step reports its LLM usage, paid
 * searches and finance lookups here; the runner stores the resulting report on
 * the run record. Prices are never configured: a line is priced only when the
 * provider reports the cost with the response (LLM/search/finance usage),
 * otherwise the usage is recorded as unpriced.
 */
export class CostTracker {
  private readonly accumulators = new Map<string, Accumulator>();

  addLlm(step: string, usage: LlmUsage, calls = 1): number {
    return this.meter(step, "llm", { calls }, usage);
  }

  addSearch(step: string, provider: string, usage: SearchUsage): number {
    return this.meter(
      step,
      provider,
      { requests: usage.requests, unpriced: usage.unpriced },
      usage,
    );
  }

  addFinance(step: string, provider: string, usage: FinanceUsageSummary): number {
    return this.meter(step, provider, { lookups: usage.lookups, unpriced: usage.unpriced }, usage);
  }

  /**
   * Merges one usage batch into the step/provider line. `unpriced` defaults to
   * every counted unit, so a missing price marks them all as unreported.
   */
  private meter(
    step: string,
    provider: string,
    counts: { calls?: number; requests?: number; lookups?: number; unpriced?: number },
    usage: { inputTokens?: number; outputTokens?: number; costUsd?: number },
  ): number {
    const entry = this.entry(step, provider);
    entry.calls += counts.calls ?? 0;
    entry.requests += counts.requests ?? 0;
    entry.lookups += counts.lookups ?? 0;
    if (usage.inputTokens !== undefined) entry.inputTokens += usage.inputTokens;
    if (usage.outputTokens !== undefined) entry.outputTokens += usage.outputTokens;

    if (usage.costUsd === undefined) {
      const units = (counts.calls ?? 0) + (counts.requests ?? 0) + (counts.lookups ?? 0);
      entry.unpriced += counts.unpriced ?? (units || 1);
      return 0;
    }
    entry.unpriced += counts.unpriced ?? 0;
    entry.usd += usage.costUsd;
    return usage.costUsd;
  }

  report(): CostReport {
    const accumulators = [...this.accumulators.values()];
    const lines = accumulators.map(toLine);
    const totalUsd = round(lines.reduce((sum, line) => sum + line.usd, 0));
    return { totalUsd, complete: accumulators.every((entry) => entry.unpriced === 0), lines };
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
        unpriced: 0,
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
    usd: round(entry.usd),
  };
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
