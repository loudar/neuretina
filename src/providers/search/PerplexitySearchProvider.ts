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
  /** Exact charge for the request; `cost.total_cost` on current responses. */
  usage?: unknown;
}

export interface PerplexitySearchOptions {
  apiKey?: string;
  baseUrl: string;
  defaultLimit?: number;
}

/** Perplexity rejects domain filters longer than this. */
const MAX_DOMAIN_FILTER = 20;

export class PerplexitySearchProvider implements SearchProvider {
  readonly name = "perplexity";
  readonly kind = "web" as const;

  constructor(private readonly options: PerplexitySearchOptions) {}

  /** Cheap fast-search probe: validates the API key without a full search. */
  async verify(): Promise<string> {
    if (!this.options.apiKey) {
      throw new ConfigurationError(
        "Perplexity is not configured. Set KEY_PERPLEXITY to a valid API key.",
      );
    }

    const response = await requestJson<{ results?: unknown[] }>(
      this.name,
      `${this.options.baseUrl}/search`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "neuretina startup check",
          max_results: 1,
          search_type: "fast",
        }),
      },
    );

    return `reachable, ${response.results?.length ?? 0} result(s)`;
  }

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
    if (query.recency === "3days") {
      // Perplexity's recency filter has no 3-day window; a publication date
      // filter gives the exact cutoff (MM/DD/YYYY).
      payload.search_after_date_filter = dateDaysAgo(3);
    } else if (query.recency) {
      payload.search_recency_filter = query.recency;
    }
    if (query.language) payload.search_language_filter = [query.language];
    // Perplexity allows at most 20 entries per request; no prefix = allowlist.
    if (query.domains && query.domains.length > 0) {
      payload.search_domain_filter = query.domains.slice(0, MAX_DOMAIN_FILTER);
    }

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

    const costUsd = reportedCostUsd(response.usage);
    return {
      query: query.query,
      provider: this.name,
      kind: this.kind,
      results,
      ...(costUsd !== undefined ? { usage: { costUsd } } : {}),
    };
  }
}

/**
 * Perplexity meters each response: current responses carry
 * `usage.cost.total_cost` (with `request_cost`); older ones a flat
 * `usage.cost` or `usage.total_cost`.
 */
function reportedCostUsd(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const nested =
    record.cost && typeof record.cost === "object"
      ? (record.cost as Record<string, unknown>).total_cost
      : undefined;
  for (const value of [record.cost, record.total_cost, nested, record.request_cost]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "web";
  }
}

/** Perplexity expects MM/DD/YYYY for date filters. */
export function dateDaysAgo(days: number, now = Date.now()): string {
  const date = new Date(now - days * 24 * 60 * 60 * 1000);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}
