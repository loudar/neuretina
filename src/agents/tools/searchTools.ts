import type { SearchProvider } from "../../capabilities/search/SearchProvider.ts";
import { SearchTool, type SearchToolOptions } from "./SearchTool.ts";

export interface SearchToolDefaults {
  /** Results per provider. */
  limit: number;
  recency?: SearchToolOptions["defaultRecency"];
  language?: string;
  /** Reputable-source allowlist; empty disables the filter. */
  domains?: string[];
}

/** One `search.<provider>` tool per configured web provider. */
export function createWebSearchTools(
  providers: SearchProvider[],
  defaults: SearchToolDefaults,
): SearchTool[] {
  return providers.map(
    (provider) =>
      new SearchTool({
        provider,
        toolName: `search.${provider.name}`,
        defaultLimit: defaults.limit,
        defaultRecency: defaults.recency,
        defaultLanguage: defaults.language,
        domains: defaults.domains,
      }),
  );
}

/** The social provider under `search.bluesky`. */
export function createSocialSearchTool(
  provider: SearchProvider,
  defaults: Pick<SearchToolDefaults, "limit" | "recency">,
): SearchTool {
  return new SearchTool({
    provider,
    toolName: "search.bluesky",
    defaultLimit: defaults.limit,
    defaultRecency: defaults.recency,
  });
}
