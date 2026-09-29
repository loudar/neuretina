import type { SearchProvider, SearchResponse } from "../../capabilities/search/SearchProvider.ts";
import type { Tool } from "../Tool.ts";

export interface SearchToolOptions {
  provider: SearchProvider;
  toolName?: string;
  description?: string;
  defaultLimit?: number;
  defaultRecency?: "hour" | "day" | "week" | "month" | "year";
}

export class SearchTool implements Tool<SearchResponse> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;

  private readonly provider: SearchProvider;
  private readonly defaultLimit: number;
  private readonly defaultRecency?: SearchToolOptions["defaultRecency"];

  constructor(options: SearchToolOptions) {
    this.provider = options.provider;
    this.name = options.toolName ?? `${options.provider.name}_search`;
    this.description = options.description ?? describeKind(this.provider);
    this.defaultLimit = options.defaultLimit ?? 6;
    this.defaultRecency = options.defaultRecency;

    this.parameters = {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query. Plain keywords or a short phrase work best.",
        },
        limit: {
          type: "integer",
          description: `Maximum number of results to return (default ${this.defaultLimit}).`,
          minimum: 1,
          maximum: this.provider.kind === "social" ? 100 : 20,
        },
        recency: {
          type: "string",
          enum: ["hour", "day", "week", "month", "year"],
          description: "Only return results from this time window (default: day).",
        },
      },
      required: ["query"],
    };
  }

  async execute(args: Record<string, unknown>): Promise<SearchResponse> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) throw new Error("`query` is required");

    const limit = typeof args.limit === "number" ? args.limit : this.defaultLimit;
    const recency = isRecency(args.recency) ? args.recency : this.defaultRecency;

    return this.provider.search({ query, limit, recency });
  }
}

function describeKind(provider: SearchProvider): string {
  switch (provider.kind) {
    case "web":
      return "Search the public web for recent articles and pages. Returns ranked results with title, URL, snippet and publication date.";
    case "social":
      return "Search social media posts (Bluesky / AT Protocol). Returns recent public posts with author, text, permalink and engagement.";
    case "news":
      return "Search recent news coverage. Returns articles with title, URL, snippet and publication date.";
  }
}

function isRecency(value: unknown): value is NonNullable<SearchToolOptions["defaultRecency"]> {
  return value === "hour" || value === "day" || value === "week" || value === "month" || value === "year";
}
