export type SearchKind = "web" | "social" | "news";

/**
 * Time window for search results. "3days" is an exact window (Perplexity
 * cannot express it as a recency filter, so providers use a date filter);
 * the rest are the coarse windows providers natively support.
 */
export type SearchRecency = "hour" | "day" | "3days" | "week" | "month" | "year";

export interface SearchMedia {
  type: "image" | "video";
  /** Small preview URL (e.g. the Bluesky CDN thumbnail). */
  thumbUrl: string;
  /** Full-size image URL; the thumbnail for video posts. */
  fullUrl: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface SearchQuery {
  query: string;
  limit?: number;
  recency?: SearchRecency;
  /** ISO 639-1 language code, e.g. "en". */
  language?: string;
  sort?: "relevance" | "latest";
  /** Allowlist of domains (root domains, TLDs like ".gov", or "domain.com/path"). */
  domains?: string[];
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
  meta?: Record<string, unknown>;
  /** Attached media, when the provider returns any (social posts). */
  media?: SearchMedia[];
}

export interface SearchResponse {
  query: string;
  provider: string;
  kind: SearchKind;
  results: SearchResult[];
  /** Provider-reported usage, when the provider returns it (Perplexity does). */
  usage?: {
    /** Exact cost in USD for this request. */
    costUsd?: number;
  };
}

export interface SearchProvider {
  readonly name: string;
  readonly kind: SearchKind;
  search(query: SearchQuery): Promise<SearchResponse>;
}
