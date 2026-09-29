export type SearchKind = "web" | "social" | "news";

export interface SearchQuery {
  query: string;
  limit?: number;
  recency?: "hour" | "day" | "week" | "month" | "year";
  language?: string;
  sort?: "relevance" | "latest";
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
  meta?: Record<string, unknown>;
}

export interface SearchResponse {
  query: string;
  provider: string;
  kind: SearchKind;
  results: SearchResult[];
}

export interface SearchProvider {
  readonly name: string;
  readonly kind: SearchKind;
  search(query: SearchQuery): Promise<SearchResponse>;
}
