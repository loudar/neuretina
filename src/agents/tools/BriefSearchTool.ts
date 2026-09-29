import type { BriefRepository } from "../../domain/briefs/BriefRepository.ts";
import type { Tool } from "../Tool.ts";

export interface PastBriefsResult {
  briefs: Array<{
    id: string;
    date: string;
    topics: string[];
    excerpt: string;
  }>;
  note?: string;
}

/**
 * Lets the research agent look up earlier briefings, so it can build on what
 * was already covered instead of repeating it.
 */
export class BriefSearchTool implements Tool<PastBriefsResult> {
  readonly name = "past_briefs";
  readonly description =
    "Look up earlier briefing summaries. Use this to see what was already covered and what has changed since, so your notes build on prior coverage instead of repeating it.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Keywords to search in earlier briefs. Omit to get the most recent briefs.",
      },
      limit: {
        type: "integer",
        description: "How many earlier briefs to return (default 3, max 10).",
        minimum: 1,
        maximum: 10,
      },
    },
    required: [],
  };

  constructor(private readonly briefs: BriefRepository) {}

  async execute(args: Record<string, unknown>): Promise<PastBriefsResult> {
    const query = typeof args.query === "string" ? args.query.trim() : undefined;
    const limit = typeof args.limit === "number" ? Math.min(Math.max(Math.floor(args.limit), 1), 10) : 3;

    const found = this.briefs.search(query || undefined, limit);
    if (found.length === 0) {
      return { briefs: [], note: "No earlier briefs are stored yet." };
    }

    return {
      briefs: found.map((brief) => ({
        id: brief.id,
        date: new Date(brief.createdAt).toISOString().slice(0, 10),
        topics: brief.topics,
        excerpt: brief.markdown.slice(0, 800),
      })),
    };
  }
}
