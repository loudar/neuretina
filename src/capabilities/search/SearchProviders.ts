import {
  activeConnection,
  isConnection,
  parseConnections,
  type Connection,
  type ConnectionPreset,
} from "../connections.ts";

/**
 * Perplexity and Exa both expose a keyed API that returns ranked results.
 * One connection per provider keeps the tool names stable (`search.<provider>`).
 */
export type SearchProviderId = "perplexity" | "exa";

export interface SearchConnection extends Connection {
  provider: SearchProviderId;
}

export const SEARCH_PROVIDER_PRESETS: Record<SearchProviderId, ConnectionPreset> = {
  perplexity: {
    label: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
  },
  exa: {
    label: "Exa",
    defaultBaseUrl: "https://api.exa.ai",
  },
};

export const SEARCH_PROVIDER_IDS = Object.keys(SEARCH_PROVIDER_PRESETS) as SearchProviderId[];

export function activeSearchConnection(
  connections: SearchConnection[],
  selected?: string,
): SearchConnection | undefined {
  return activeConnection(connections, selected);
}

export function isSearchConnection(value: unknown): value is SearchConnection {
  return isConnection(value, SEARCH_PROVIDER_PRESETS);
}

export function parseSearchConnections(value: unknown): SearchConnection[] | undefined {
  return parseConnections<SearchConnection>(value, SEARCH_PROVIDER_PRESETS, "provider");
}
