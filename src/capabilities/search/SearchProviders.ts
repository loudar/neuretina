/**
 * Web-search connections. Perplexity and Exa both expose a keyed API that
 * returns ranked results, so one generic connection shape covers both; the
 * presets only prefill endpoints and labels. One connection per provider
 * keeps the tool names stable (`search.<provider>`).
 */
export type SearchProviderId = "perplexity" | "exa";

export interface SearchConnection {
  id: string;
  provider: SearchProviderId;
  /** API base, e.g. https://api.perplexity.ai. */
  baseUrl: string;
  apiKey?: string;
}

export interface SearchProviderPreset {
  /** Display name of the provider, e.g. "Perplexity". */
  label: string;
  defaultBaseUrl: string;
}

export const SEARCH_PROVIDER_PRESETS: Record<SearchProviderId, SearchProviderPreset> = {
  perplexity: {
    label: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
  },
  exa: {
    label: "Exa",
    defaultBaseUrl: "https://api.exa.ai",
  },
};

/** Shape check for values coming from settings or imported bundles. */
export function isSearchConnection(value: unknown): value is SearchConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.provider !== "string") return false;
  if (!SEARCH_PROVIDER_PRESETS[record.provider as SearchProviderId]) return false;
  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) return false;
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") return false;
  return true;
}

/** The connection single-search call sites use: the selected id, else the first. */
export function activeSearchConnection(
  connections: SearchConnection[],
  selected?: string,
): SearchConnection | undefined {
  const list = Array.isArray(connections) ? connections : [];
  return list.find((connection) => connection.id === selected) ?? list[0];
}

/** Parses a stored connection list; undefined when invalid or duplicated. */
export function parseSearchConnections(
  value: unknown,
): SearchConnection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const connections: SearchConnection[] = [];
  const seen = new Set<SearchProviderId>();
  for (const entry of value) {
    if (!isSearchConnection(entry) || seen.has(entry.provider)) return undefined;
    seen.add(entry.provider);
    connections.push({
      id: entry.id.trim(),
      provider: entry.provider,
      baseUrl: entry.baseUrl.trim(),
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    });
  }
  return connections;
}
