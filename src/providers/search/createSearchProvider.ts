import {
  isSearchConnection,
  type SearchConnection,
  type SearchProviderId,
} from "../../capabilities/search/SearchProviders.ts";
import type { SearchProvider } from "../../capabilities/search/SearchProvider.ts";
import { ExaSearchProvider } from "./ExaSearchProvider.ts";
import { PerplexitySearchProvider } from "./PerplexitySearchProvider.ts";

export interface SearchProviderOptions {
  /** Results per query when the tool does not ask for a limit. */
  defaultLimit?: number;
}

/** One provider per configured connection; malformed and duplicate rows are skipped. */
export function createSearchProviders(
  connections: SearchConnection[],
  options: SearchProviderOptions = {},
): SearchProvider[] {
  if (!Array.isArray(connections)) return [];
  const providers: SearchProvider[] = [];
  const seen = new Set<SearchProviderId>();
  for (const connection of connections) {
    if (!isSearchConnection(connection) || seen.has(connection.provider)) continue;
    seen.add(connection.provider);
    providers.push(createSearchProvider(connection, options));
  }
  return providers;
}

/** Builds the concrete provider for one web-search connection. */
export function createSearchProvider(
  connection: SearchConnection,
  options: SearchProviderOptions = {},
): SearchProvider {
  const common = {
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    defaultLimit: options.defaultLimit,
  };

  switch (connection.provider) {
    case "exa":
      return new ExaSearchProvider(common);
    case "perplexity":
      return new PerplexitySearchProvider(common);
  }
}
