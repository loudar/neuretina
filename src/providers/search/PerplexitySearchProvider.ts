import { ConfigurationError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";
import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "../../capabilities/search/SearchProvider.ts";

interface PerplexitySearchResponse {
  results: Array<{
    title: string;
    url: string;
    snippet: string;
    date?: string | null;
    last_updated?: string | null;
  }>;
  id: string;
}

export interface PerplexitySearchOptions {
  apiKey?: string;
  baseUrl: string;
  defaultLimit?: number;
}

export class PerplexitySearchProvider implements SearchProvider {
  readonly name = "perplexity";
  readonly kind = "web" as const;

  constructor(private readonly options: PerplexitySearchOptions) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    if (!this.options.apiKey) {
      throw new ConfigurationError(
        "Perplexity is not configured. Set KEY_PERPLEXITY to a valid API key.",
      );
    }

    const payload: Record<string, unknown> = {
      query: query.query,
      max_results: query.limit ?? this.options.defaultLimit ?? 10,
      search_type: "web",
    };
    if (query.recency) payload.search_recency_filter = query.recency;

    const response = await requestJson<PerplexitySearchResponse>(
      this.name,
      `${this.options.baseUrl}/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const results: SearchResult[] = (response.results ?? []).map((item) => ({
      title: item.title,
      url: item.url,
      snippet: item.snippet,
      publishedAt: item.date ?? item.last_updated ?? undefined,
      source: hostnameOf(item.url),
    }));

    return { query: query.query, provider: this.name, kind: this.kind, results };
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}
