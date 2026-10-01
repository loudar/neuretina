import { describe, expect, test } from "bun:test";
import { createLogger } from "../src/core/logger.ts";
import { levenshteinDistance, textSimilarity } from "../src/core/text.ts";
import { EventRepository, type TimelineEvent } from "../src/domain/events/EventRepository.ts";
import { EventExtractor } from "../src/workflows/EventExtraction.ts";
import { renderTimelineMarkdown, selectTimelineEvents } from "../src/workflows/EventTimeline.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { completion, stubLlm } from "./support.ts";

const log = createLogger("test", { level: "error" });

describe("EventRepository", () => {
  test("round-trips events with normalized fields and filters", () => {
    const repo = new EventRepository(new SqliteDatabase(":memory:"));

    const first = repo.upsert({
      date: "2026-09-01",
      time: "9:05",
      entities: ["Nvidia", "nvidia"],
      tags: ["Markets", "AI"],
      title: "Nvidia earnings",
      description: "Beat consensus.",
    });
    expect(first.time).toBe("09:05");
    expect(first.entities).toEqual(["Nvidia"]);
    expect(first.tags).toEqual(["Markets", "AI"]);
    expect(repo.count()).toBe(1);

    const second = repo.upsert({
      date: "2026-09-05",
      entities: ["Rust"],
      tags: ["AI"],
      title: "Rust 1.90",
    });
    // Most used tags first.
    expect(repo.tags()).toEqual(["AI", "Markets"]);

    // Updating keeps the fields that are not passed.
    const updated = repo.upsert({ id: first.id, date: "2026-09-02", title: "Nvidia earnings beat" });
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.title).toBe("Nvidia earnings beat");
    expect(updated.entities).toEqual(["Nvidia"]);
    expect(updated.tags).toEqual(["Markets", "AI"]);
    expect(repo.count()).toBe(2);

    expect(repo.list().map((event) => event.title)).toEqual([
      "Rust 1.90",
      "Nvidia earnings beat",
    ]);
    expect(repo.list({ from: "2026-09-03" }).map((event) => event.title)).toEqual(["Rust 1.90"]);
    expect(repo.list({ to: "2026-09-03" }).map((event) => event.title)).toEqual([
      "Nvidia earnings beat",
    ]);
    expect(repo.list({ tags: ["markets"] }).map((event) => event.title)).toEqual([
      "Nvidia earnings beat",
    ]);
    expect(repo.list({ entities: ["rust"] }).map((event) => event.title)).toEqual(["Rust 1.90"]);
    expect(repo.list({ ids: [first.id] })).toHaveLength(1);
    expect(repo.list({ limit: 1 })).toHaveLength(1);

    expect(() => repo.upsert({ date: "yesterday", title: "x" })).toThrow(/YYYY-MM-DD/);
    expect(() => repo.upsert({ date: "2026-09-01", title: "  " })).toThrow(/title/);
    expect(() => repo.get("missing")).toThrow(/not found/);

    const removed = repo.remove(second.id);
    expect(removed.id).toBe(second.id);
    expect(repo.count()).toBe(1);
  });
});

describe("text similarity", () => {
  test("measures edit distance and percentage match", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("same", "same")).toBe(0);
    expect(textSimilarity("Nvidia earnings", "nvidia earnings")).toBe(1);
    expect(textSimilarity("Nvidia earnings", "Nvidia earnings beat")).toBeGreaterThan(0.7);
    expect(textSimilarity("Rust release", "EU AI Act ruling")).toBeLessThan(0.4);
  });
});

describe("EventExtractor", () => {
  test("suggests events, reviews duplicates and grows the tag list", async () => {
    const events = new EventRepository(new SqliteDatabase(":memory:"));
    const existing = events.upsert({
      date: "2026-09-29",
      tags: ["markets"],
      title: "Nvidia earnings",
      description: "Old note.",
    });

    const calls: string[] = [];
    const llm = stubLlm((request) => {
      const system = request.messages[0]?.content ?? "";
      calls.push(system);

      if (system.includes("extract dated events")) {
        return completion(
          JSON.stringify({
            events: [
              {
                date: "2026-09-30",
                title: "Nvidia earnings beat",
                description: "Revenue beat consensus.",
                entities: ["Nvidia"],
              },
              {
                date: "2026-09-30",
                title: "Rust 1.90 released",
                description: "Faster builds.",
                entities: ["Rust"],
              },
            ],
          }),
        );
      }

      if (system.includes("You review a newly suggested event")) {
        return completion(
          JSON.stringify({
            action: "update",
            id: existing.id,
            date: "2026-09-30",
            title: "Nvidia earnings beat",
            description: "Revenue beat consensus and guidance rose.",
            entities: ["Nvidia"],
          }),
        );
      }

      if (system.includes("strict categorizer")) {
        const user = JSON.parse(request.messages[1]?.content ?? "{}") as {
          event?: { title?: string };
        };
        if (user.event?.title === "Rust 1.90 released") {
          return completion(JSON.stringify({ tags: [{ tag: "other", confidence: 0.8 }] }));
        }
        return completion(
          JSON.stringify({
            tags: [
              { tag: "markets", confidence: 0.92 },
              { tag: "not-a-tag", confidence: 0.2 },
            ],
          }),
        );
      }

      if (system.includes("Invent ONE short")) {
        return completion(JSON.stringify({ tag: "Developer Tools" }));
      }

      return completion("{}");
    });

    const extractor = new EventExtractor({ llm, events, logger: log });
    const result = await extractor.extract({ briefId: "brief-1", brief: "# Brief", sources: [] });

    // The first suggestion updated the stored event instead of duplicating it.
    expect(result.events).toHaveLength(2);
    expect(events.count()).toBe(2);
    const updated = events.get(existing.id);
    expect(updated.date).toBe("2026-09-30");
    expect(updated.title).toBe("Nvidia earnings beat");
    expect(updated.description).toContain("guidance rose");
    expect(updated.tags).toEqual(["markets"]);
    expect(updated.sourceBriefId).toBe("brief-1");

    // The second used "other": the decision step invented a tag, normalized it
    // and it is now part of the shared tag list.
    const rust = result.events.find((event) => event.title === "Rust 1.90 released");
    expect(rust?.tags).toEqual(["developer-tools"]);
    expect(result.newTags).toEqual(["developer-tools"]);
    expect(events.tags()).toContain("developer-tools");

    // suggest + review + categorize ×2 + generate.
    expect(calls).toHaveLength(5);
  });
});

describe("EventTimeline", () => {
  test("selects related events and renders markdown", () => {
    const anchor = event({ id: "a", date: "2026-09-30", tags: ["ai"], entities: ["OpenAI"] });
    const byEntity = event({ id: "b", date: "2026-01-01", entities: ["OpenAI"] });
    const byTag = event({ id: "c", date: "2026-09-20", tags: ["ai"] });
    const unrelated = event({ id: "d", date: "2026-09-30", tags: ["markets"], entities: ["Nvidia"] });
    const staleTag = event({ id: "e", date: "2025-01-01", tags: ["ai"] });

    const selected = selectTimelineEvents([anchor], [anchor, byEntity, byTag, unrelated, staleTag]);
    expect(selected.map((entry) => entry.id)).toEqual(["a", "c", "b"]);
    expect(selected.some((entry) => entry.id === "d")).toBe(false);
    expect(selected.some((entry) => entry.id === "e")).toBe(false);

    const markdown = renderTimelineMarkdown(selected);
    expect(markdown).toContain("## Timeline");
    expect(markdown).toContain("### 2026-09-30");
    expect(markdown).toContain("**OpenAI launch**");
    expect(markdown).toContain("#ai");
    expect(markdown).toContain("OpenAI");
  });
});

function event(overrides: Partial<TimelineEvent> & { id: string }): TimelineEvent {
  return {
    date: "2026-09-30",
    entities: [],
    tags: [],
    title: "OpenAI launch",
    description: "Something happened.",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}
