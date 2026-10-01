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

/** Records an agent run's LLM usage, paid searches and finance lookups. */
export function addAgentCost(
  tracker: CostTracker | undefined,
  step: string,
  result: AgentRunResult,
): number {
  if (!tracker) return 0;
  let usd = tracker.addLlm(step, result.usage, Math.max(1, result.steps.length));
  const requests = countWebSearches(result);
  if (requests > 0) usd += tracker.addPerplexitySearch(step, requests);
  for (const usage of collectFinanceUsage(result)) usd += tracker.addFinance(step, usage);
  return usd;
}

export function countWebSearches(result: AgentRunResult): number {
  let count = 0;
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const byTool = (invocation.result as { toolCallsByTool?: unknown } | undefined)
        ?.toolCallsByTool;
      if (byTool && typeof byTool === "object") {
        for (const [tool, calls] of Object.entries(byTool)) {
          if (WEB_SEARCH_TOOLS.has(tool) && typeof calls === "number") count += calls;
        }
      } else if (WEB_SEARCH_TOOLS.has(invocation.tool)) {
        count += 1;
      }
    }
  }
  return count;
}

export function collectFinanceUsage(result: AgentRunResult): FinanceUsage[] {
  const usages: FinanceUsage[] = [];
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const response = invocation.result as
        | { usage?: unknown; toolUsages?: unknown }
        | undefined;
      collectUsage(response?.usage, usages);
      if (Array.isArray(response?.toolUsages)) {
        for (const entry of response.toolUsages) {
          if (entry && typeof entry === "object") {
            collectUsage((entry as { usage?: unknown }).usage, usages);
          }
        }
      }
    }
  }
  return usages;
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


