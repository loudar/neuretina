export type SearchKind = "web" | "social" | "news";

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
  /** Attached media, when the provider returns any (social posts). */
  media?: SearchMedia[];
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
