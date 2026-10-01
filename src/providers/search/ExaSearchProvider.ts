import { ConfigurationError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";
import type {
  SearchProvider,
  SearchQuery,
  SearchRecency,
  SearchResponse,
  SearchResult,
} from "../../capabilities/search/SearchProvider.ts";

interface ExaSearchResponse {
  results?: Array<{
    title?: string | null;
    url?: string | null;
    publishedDate?: string | null;
    author?: string | null;
    text?: string | null;
    highlights?: string[] | null;
  }>;
}

export interface ExaSearchOptions {
  apiKey?: string;
  baseUrl: string;
  defaultLimit?: number;
}

/** Exa's neural/keyword web search; a second, independent web index. */
export class ExaSearchProvider implements SearchProvider {
  readonly name = "exa";
  readonly kind = "web" as const;

  constructor(private readonly options: ExaSearchOptions) {}

  /** Cheap probe: validates the API key without a full search. */
  async verify(): Promise<string> {
    if (!this.options.apiKey) {
      throw new ConfigurationError("Exa is not configured. Set KEY_EXA to a valid API key.");
    }

    const response = await requestJson<ExaSearchResponse>(
      this.name,
      `${this.options.baseUrl}/search`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ query: "neuretina startup check", numResults: 1, type: "fast" }),
      },
    );

    return `reachable, ${response.results?.length ?? 0} result(s)`;
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    if (!this.options.apiKey) {
      throw new ConfigurationError("Exa is not configured. Set KEY_EXA to a valid API key.");
    }

    const payload: Record<string, unknown> = {
      query: query.query,
      numResults: query.limit ?? this.options.defaultLimit ?? 10,
      type: "auto",
      contents: { text: { maxCharacters: 1000 } },
    };
    const since = recencyStart(query.recency);
    if (since) payload.startPublishedDate = since;
    // Exa takes exact domains only (no TLDs, paths or wildcards).
    const domains = (query.domains ?? []).filter(
      (domain) => !domain.startsWith(".") && !domain.includes("/"),
    );
    if (domains.length > 0) payload.includeDomains = domains.slice(0, 20);

    const response = await requestJson<ExaSearchResponse>(
      this.name,
      `${this.options.baseUrl}/search`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      },
    );

    const results: SearchResult[] = (response.results ?? [])
      .map((item) => ({
        title: item.title ?? item.url ?? "",
        url: item.url ?? "",
        snippet: item.text?.trim() || item.highlights?.[0] || "",
        publishedAt: item.publishedDate ?? undefined,
        source: hostnameOf(item.url ?? ""),
        ...(item.author ? { meta: { author: item.author } } : {}),
      }))
      .filter((result) => result.url.length > 0);

    return { query: query.query, provider: this.name, kind: this.kind, results };
  }

  private headers(): Record<string, string> {
    return { "x-api-key": this.options.apiKey ?? "", "Content-Type": "application/json" };
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

function recencyStart(recency: SearchRecency | undefined): string | undefined {
  if (!recency) return undefined;
  return new Date(Date.now() - RECENCY_DAYS[recency] * 24 * 60 * 60 * 1000).toISOString();
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}
