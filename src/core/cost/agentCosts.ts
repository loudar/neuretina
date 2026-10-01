import type { AgentRunResult } from "../../agents/Agent.ts";
import type { FinanceUsage } from "../../capabilities/finance/FinanceProvider.ts";
import { finiteNumber } from "../records.ts";
import type { CostTracker } from "./CostTracker.ts";

/** Sandbox tools that run against the paid Perplexity web search. */
const WEB_SEARCH_TOOLS = new Set([
  "search.perplexity",
  "perplexity_search",
  "wikipedia_search",
  "web_search",
]);

/** Finance tools are named `finance.<provider>`; priced usage comes from Perplexity's Agent API. */
const FINANCE_TOOL_PREFIX = "finance.";

/** Records an agent run's LLM usage, paid searches and finance lookups. */
export function addAgentCost(
  tracker: CostTracker | undefined,
  step: string,
  result: AgentRunResult,
): number {
  if (!tracker) return 0;
  let usd = tracker.addLlm(step, result.usage, Math.max(1, result.steps.length));

  const search = collectSearchUsage(result);
  if (search.reported > 0) usd += tracker.addPerplexitySearch(step, search.reported, search.costUsd);
  if (search.unpriced > 0) usd += tracker.addPerplexitySearch(step, search.unpriced);

  for (const usage of collectFinanceUsage(result)) usd += tracker.addFinance(step, usage);
  return usd;
}

export interface SearchUsageSummary {
  /** Search calls that ran. */
  requests: number;
  /** Calls whose provider reported a cost. */
  reported: number;
  /** Calls the provider left unpriced. */
  unpriced: number;
  /** Sum of the reported costs. */
  costUsd: number;
}

/**
 * Attributes web-search calls to their provider-reported costs: Perplexity
 * returns `usage.cost.total_cost`, so those calls are priced exactly while the
 * rest (e.g. Exa, Wikipedia, Bluesky) stay unpriced.
 */
export function collectSearchUsage(result: AgentRunResult): SearchUsageSummary {
  const summary: SearchUsageSummary = { requests: 0, reported: 0, unpriced: 0, costUsd: 0 };
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const response = invocation.result as
        | { toolCallsByTool?: unknown; toolUsages?: unknown; usage?: unknown }
        | undefined;
      const byTool = response?.toolCallsByTool;
      if (byTool && typeof byTool === "object") {
        for (const [tool, calls] of Object.entries(byTool)) {
          if (WEB_SEARCH_TOOLS.has(tool) && typeof calls === "number") summary.requests += calls;
        }
      } else if (WEB_SEARCH_TOOLS.has(invocation.tool)) {
        summary.requests += 1;
      }

      if (Array.isArray(response?.toolUsages)) {
        for (const entry of response.toolUsages) {
          if (!entry || typeof entry !== "object") continue;
          const record = entry as { tool?: unknown; usage?: unknown };
          if (typeof record.tool !== "string" || !WEB_SEARCH_TOOLS.has(record.tool)) continue;
          const costUsd = costOf(record.usage);
          if (costUsd === undefined) continue;
          summary.reported += 1;
          summary.costUsd += costUsd;
        }
      }

      if (WEB_SEARCH_TOOLS.has(invocation.tool)) {
        const costUsd = costOf(response?.usage);
        if (costUsd !== undefined) {
          summary.reported += 1;
          summary.costUsd += costUsd;
        }
      }
    }
  }
  summary.unpriced = Math.max(0, summary.requests - summary.reported);
  return summary;
}

export function countWebSearches(result: AgentRunResult): number {
  return collectSearchUsage(result).requests;
}

export function collectFinanceUsage(result: AgentRunResult): FinanceUsage[] {
  const usages: FinanceUsage[] = [];
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const response = invocation.result as
        | { usage?: unknown; toolUsages?: unknown }
        | undefined;
      if (invocation.tool.startsWith(FINANCE_TOOL_PREFIX)) collectUsage(response?.usage, usages);
      if (Array.isArray(response?.toolUsages)) {
        for (const entry of response.toolUsages) {
          if (!entry || typeof entry !== "object") continue;
          const record = entry as { tool?: unknown; usage?: unknown };
          if (typeof record.tool !== "string" || !record.tool.startsWith(FINANCE_TOOL_PREFIX)) continue;
          collectUsage(record.usage, usages);
        }
      }
    }
  }
  return usages;
}

function costOf(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  return finiteNumber((usage as Record<string, unknown>).costUsd);
}

function collectUsage(usage: unknown, out: FinanceUsage[]): void {
  if (!usage || typeof usage !== "object") return;
  const record = usage as Record<string, unknown>;
  const inputTokens = finiteNumber(record.inputTokens);
  const outputTokens = finiteNumber(record.outputTokens);
  const costUsd = finiteNumber(record.costUsd);
  if (inputTokens === undefined && outputTokens === undefined && costUsd === undefined) return;
  out.push({
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(costUsd !== undefined ? { costUsd } : {}),
  });
}
