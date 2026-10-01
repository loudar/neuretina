import { describe, expect, test } from "bun:test";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { BriefShareRepository } from "../src/domain/briefs/BriefShareRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";

function setup(): BriefRepository {
  const db = new SqliteDatabase(":memory:");
  return new BriefRepository(new ArtifactRepository(db), new BriefShareRepository(db));
}

function createBrief(briefs: BriefRepository, topics: string[] = ["Rust"]) {
  return briefs.create({
    topics,
    markdown: `# ${topics.join(", ")}`,
    narration: "spoken",
    sources: [],
  });
}

describe("brief shares", () => {
  test("gives every brief a stable token that resolves back to it", () => {
    const briefs = setup();
    const brief = createBrief(briefs);

    const token = briefs.shareToken(brief.id);
    expect(token).toBeTruthy();
    expect(briefs.shareToken(brief.id)).toBe(token!);
    expect(briefs.findByShareToken(token!)?.id).toBe(brief.id);
  });

  test("tokens are unique per brief and unknown ones resolve to null", () => {
    const briefs = setup();
    const first = createBrief(briefs, ["Rust"]);
    const second = createBrief(briefs, ["AI"]);

    expect(briefs.shareToken(first.id)).not.toBe(briefs.shareToken(second.id));
    expect(briefs.findByShareToken("not-a-token")).toBeNull();
  });

  test("deleting a brief revokes its token", () => {
    const briefs = setup();
    const brief = createBrief(briefs);
    const token = briefs.shareToken(brief.id)!;

    briefs.remove(brief.id);

    expect(briefs.findByShareToken(token)).toBeNull();
  });

  test("a forgotten share resolves to null even while the brief exists", () => {
    const briefs = setup();
    const brief = createBrief(briefs);
    const token = briefs.shareToken(brief.id)!;

    briefs.forgetShare(brief.id);

    expect(briefs.findByShareToken(token)).toBeNull();
    expect(briefs.shareToken(brief.id)).not.toBe(token);
  });
});
