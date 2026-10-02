import {
  SEARCH_PROVIDER_PRESETS,
  type SearchConnection,
} from "../../capabilities/search/SearchProviders.ts";
import { filterConnections } from "../../capabilities/connections.ts";
import type { SearchProvider } from "../../capabilities/search/SearchProvider.ts";
import { ExaSearchProvider } from "./ExaSearchProvider.ts";
import { PerplexitySearchProvider } from "./PerplexitySearchProvider.ts";

export interface SearchProviderOptions {
  /** Results per query when the tool does not ask for a limit. */
  defaultLimit?: number;
}

/** One provider per configured connection; malformed rows are skipped. */
export function createSearchProviders(
  connections: SearchConnection[],
  options: SearchProviderOptions = {},
): SearchProvider[] {
  return filterConnections<SearchConnection>(
    connections,
    SEARCH_PROVIDER_PRESETS,
    "provider",
  ).map((connection) => createSearchProvider(connection, options));
}

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
