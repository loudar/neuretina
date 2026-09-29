import { describe, expect, test } from "bun:test";
import { BriefGetTool } from "../src/agents/tools/BriefGetTool.ts";
import { BriefSearchTool } from "../src/agents/tools/BriefSearchTool.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";

function setup(): BriefRepository {
  const db = new SqliteDatabase(":memory:");
  const briefs = new BriefRepository(db);
  briefs.create({
    topics: ["Rust"],
    markdown: "Rust 1.90 shipped with async closures.",
    narration: "",
    sources: [
      { title: "Rust blog", url: "https://blog.rust-lang.org/1.90", provider: "perplexity" },
    ],
  });
  briefs.create({
    topics: ["AI regulation"],
    markdown: "The EU delayed its AI Act guidance.",
    narration: "",
    sources: [],
  });
  return briefs;
}

describe("past brief tools", () => {
  test("past_briefs searches by topic and returns ids", async () => {
    const tool = new BriefSearchTool(setup());

    const result = await tool.execute({ query: "Rust" });

    expect(result.briefs).toHaveLength(1);
    expect(result.briefs[0]?.topics).toEqual(["Rust"]);
    expect(result.briefs[0]?.excerpt).toContain("async closures");
    expect(result.briefs[0]?.id).toBeTruthy();
  });

  test("past_brief opens one brief in full with its sources", async () => {
    const briefs = setup();
    const found = await new BriefSearchTool(briefs).execute({ query: "Rust" });
    const id = found.briefs[0]!.id;

    const brief = await new BriefGetTool(briefs).execute({ id });

    expect(brief.id).toBe(id);
    expect(brief.topics).toEqual(["Rust"]);
    expect(brief.markdown).toContain("async closures");
    expect(brief.sources[0]?.url).toBe("https://blog.rust-lang.org/1.90");
    expect(brief.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("past_brief rejects unknown ids and missing arguments", async () => {
    const tool = new BriefGetTool(setup());

    await expect(tool.execute({ id: "missing" })).rejects.toThrow("No earlier brief");
    await expect(tool.execute({})).rejects.toThrow("`id` is required");
  });
});
