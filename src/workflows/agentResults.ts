import type { AgentRunResult } from "../agents/Agent.ts";
import type { BriefSource } from "../domain/briefs/BriefRepository.ts";

/** Walks an agent run and gathers every search source it touched. */
export function collectSources(result: AgentRunResult): BriefSource[] {
  const sources: BriefSource[] = [];
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const response = invocation.result as
        | { results?: unknown; provider?: unknown }
        | undefined;
      if (!response || !Array.isArray(response.results)) continue;
      const fallback =
        typeof response.provider === "string" ? response.provider : invocation.tool;
      for (const item of response.results) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        if (typeof record.url !== "string" || !record.url) continue;
        const snippet =
          typeof record.snippet === "string" && record.snippet.trim()
            ? record.snippet.trim()
            : undefined;
        const media = Array.isArray(record.media) ? (record.media as BriefSource["media"]) : undefined;
        sources.push({
          title:
            typeof record.title === "string" && record.title ? record.title : record.url,
          url: record.url,
          provider: typeof record.provider === "string" ? record.provider : fallback,
          ...(snippet ? { snippet } : {}),
          ...(media && media.length > 0 ? { media } : {}),
        });
      }
    }
  }
  return sources;
}

/** Walks an agent run and gathers every query/question it passed to a tool. */
export function collectQueries(result: AgentRunResult): string[] {
  const queries: string[] = [];
  for (const step of result.steps) {
    for (const invocation of step.invocations) {
      const query = invocation.args.query ?? invocation.args.question;
      if (typeof query === "string" && query.trim()) queries.push(query.trim());

      // Code mode reports the queries made inside the sandbox.
      const recorded = (invocation.result as { queries?: unknown } | undefined)?.queries;
      if (Array.isArray(recorded)) {
        for (const item of recorded) {
          if (typeof item === "string" && item.trim()) queries.push(item.trim());
        }
      }
    }
  }
  return queries;
}
