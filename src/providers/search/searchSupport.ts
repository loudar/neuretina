import type { SearchRecency } from "../../capabilities/search/SearchProvider.ts";

/** Hostname of a result URL, or "web" when it cannot be parsed. */
export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}

const RECENCY_DAYS: Record<SearchRecency, number> = {
  hour: 1,
  day: 1,
  "3days": 3,
  week: 7,
  month: 30,
  year: 365,
};

/** ISO timestamp marking the start of a recency window (Exa-style filters). */
export function recencySinceIso(
  recency: SearchRecency | undefined,
  now = Date.now(),
): string | undefined {
  if (!recency) return undefined;
  return new Date(now - RECENCY_DAYS[recency] * 24 * 60 * 60 * 1000).toISOString();
}
