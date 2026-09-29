import { describe, expect, test } from "bun:test";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { KeyValueRepository } from "../src/domain/kv/KeyValueRepository.ts";
import { TopicRepository } from "../src/domain/topics/TopicRepository.ts";
import { JobRepository } from "../src/domain/jobs/JobRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";

function db(): SqliteDatabase {
  return new SqliteDatabase(":memory:");
}

describe("KeyValueRepository", () => {
  test("stores, updates and deletes values", () => {
    const repo = new KeyValueRepository(db());

    expect(repo.get("matrix.sync_token")).toBeNull();
    repo.set("matrix.sync_token", "s1");
    expect(repo.get("matrix.sync_token")).toBe("s1");
    repo.set("matrix.sync_token", "s2");
    expect(repo.get("matrix.sync_token")).toBe("s2");
    repo.delete("matrix.sync_token");
    expect(repo.get("matrix.sync_token")).toBeNull();
  });
});

describe("TopicRepository", () => {
  test("adds, lists, removes and rejects duplicates", () => {
    const repo = new TopicRepository(db());

    const topic = repo.add({ name: "Local-first software", description: "sync engines" });
    expect(topic.id).toBeTruthy();
    expect(repo.list()).toHaveLength(1);

    expect(() => repo.add({ name: "Local-first software" })).toThrow(/already exists/);

    repo.remove(topic.id);
    expect(repo.list()).toHaveLength(0);
    expect(() => repo.get(topic.id)).toThrow(/not found/);
  });
});

describe("JobRepository", () => {
  test("creates, updates, records results and removes jobs", () => {
    const repo = new JobRepository(db());

    const job = repo.create({
      name: "morning-brief",
      cron: "0 7 * * *",
      timezone: "Europe/Berlin",
      workflow: "briefing",
      input: { deliver: true },
    });

    expect(repo.count()).toBe(1);
    expect(job.enabled).toBe(true);
    expect(job.input).toEqual({ deliver: true });

    const updated = repo.update(job.id, { enabled: false, cron: "30 6 * * 1-5" });
    expect(updated.enabled).toBe(false);
    expect(updated.cron).toBe("30 6 * * 1-5");
    expect(repo.listEnabled()).toHaveLength(0);

    repo.setRunResult(job.id, "failed", 1234);
    expect(repo.get(job.id).lastStatus).toBe("failed");
    expect(repo.get(job.id).lastRunAt).toBe(1234);

    repo.remove(job.id);
    expect(repo.count()).toBe(0);
  });
});

describe("BriefRepository", () => {
  test("stores briefs with audio and returns them without the blob by default", () => {
    const repo = new BriefRepository(db());

    const brief = repo.create({
      correlationId: "corr-1",
      topics: ["Rust"],
      markdown: "# Rust\nAll good",
      narration: "Rust is all good",
      sources: [{ title: "Example", url: "https://example.com", provider: "perplexity" }],
    });

    repo.attachAudio(brief.id, new Uint8Array([9, 9, 9]), "audio/ogg", 4200);

    const stored = repo.get(brief.id, false);
    expect(stored.hasAudio).toBe(true);
    expect(stored.audio).toBeUndefined();
    expect(stored.audioDurationMs).toBe(4200);

    const withAudio = repo.get(brief.id, true);
    expect(withAudio.audio).toEqual(new Uint8Array([9, 9, 9]));

    const audio = repo.getAudio(brief.id);
    expect(audio?.mimeType).toBe("audio/ogg");
    expect(audio?.audio.byteLength).toBe(3);

    expect(repo.latest()?.id).toBe(brief.id);
    expect(repo.list()).toHaveLength(1);
  });
});
