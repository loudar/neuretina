import { NotFoundError } from "../../core/errors.ts";
import type { BriefRepository } from "../../domain/briefs/BriefRepository.ts";
import type { Tool } from "../Tool.ts";

export interface PastBriefResult {
  id: string;
  date: string;
  topics: string[];
  markdown: string;
  sources: Array<{ title: string; url: string }>;
}

/**
 * Lets the research agent open one earlier briefing in full after finding it
 * with the past_briefs search, so it can reference exactly what was reported
 * on a topic instead of guessing from an excerpt.
 */
export class BriefGetTool implements Tool<PastBriefResult> {
  readonly name = "past_brief";
  readonly description =
    "Get one earlier briefing in full by id: the complete text, its topics, date and sources. Use past_briefs first to search earlier briefs by topic and get an id.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "Brief id from a past_briefs result.",
      },
    },
    required: ["id"],
  };

  constructor(private readonly briefs: BriefRepository) {}

  async execute(args: Record<string, unknown>): Promise<PastBriefResult> {
    const id = typeof args.id === "string" ? args.id.trim() : "";
    if (!id) throw new Error("`id` is required");

    let brief;
    try {
      brief = this.briefs.get(id);
    } catch (error) {
      if (error instanceof NotFoundError) throw new Error(`No earlier brief with id "${id}"`);
      throw error;
    }

    return {
      id: brief.id,
      date: new Date(brief.createdAt).toISOString().slice(0, 10),
      topics: brief.topics,
      markdown: brief.markdown,
      sources: brief.sources.map((source) => ({ title: source.title, url: source.url })),
    };
  }
}
