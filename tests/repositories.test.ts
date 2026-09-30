import { describe, expect, test } from "bun:test";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { KeyValueRepository } from "../src/domain/kv/KeyValueRepository.ts";
import { TopicRepository } from "../src/domain/topics/TopicRepository.ts";
import { JobRepository } from "../src/domain/jobs/JobRepository.ts";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { WorkflowRunRepository } from "../src/domain/runs/WorkflowRunRepository.ts";

function db(): SqliteDatabase {
  return new SqliteDatabase(":memory:");
}

function briefsRepo(): BriefRepository {
  return new BriefRepository(new ArtifactRepository(db()));
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

  test("updates name and description, including clearing the description", () => {
    const repo = new TopicRepository(db());
    const topic = repo.add({ name: "Rust", description: "language" });
    const other = repo.add({ name: "AI" });

    const renamed = repo.update(topic.id, { name: "Rust ecosystem" });
    expect(renamed.name).toBe("Rust ecosystem");
    expect(renamed.description).toBe("language");

    const described = repo.update(topic.id, { description: "crates, tooling, async" });
    expect(described.description).toBe("crates, tooling, async");

    const cleared = repo.update(topic.id, { description: "  " });
    expect(cleared.description).toBeUndefined();

    expect(() => repo.update(other.id, { name: "Rust ecosystem" })).toThrow(/already exists/);
  });

  test("mutes and unmutes topics without removing them", () => {
    const repo = new TopicRepository(db());
    const topic = repo.add({ name: "Rust" });

    expect(topic.muted).toBe(false);
    expect(repo.listActive()).toHaveLength(1);

    const muted = repo.update(topic.id, { muted: true });
    expect(muted.muted).toBe(true);
    expect(repo.list()).toHaveLength(1);
    expect(repo.listActive()).toHaveLength(0);

    const unmuted = repo.update(topic.id, { muted: false });
    expect(unmuted.muted).toBe(false);
    expect(repo.listActive()).toHaveLength(1);
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
    const repo = briefsRepo();

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
    expect(stored.artifactId).toBe(brief.id);
    expect(stored.audioArtifactId).toBeTruthy();

    const withAudio = repo.get(brief.id, true);
    expect(withAudio.audio).toEqual(new Uint8Array([9, 9, 9]));

    const audio = repo.getAudio(brief.id);
    expect(audio?.mimeType).toBe("audio/ogg");
    expect(audio?.audio.byteLength).toBe(3);

    expect(repo.latest()?.id).toBe(brief.id);
    expect(repo.list()).toHaveLength(1);
  });

  test("search matches markdown and topics, and returns latest without a query", () => {
    const repo = briefsRepo();
    const rust = repo.create({
      topics: ["Rust"],
      markdown: "# Rust\nOwnership news",
      narration: "n",
      sources: [],
    });
    const ai = repo.create({
      topics: ["AI regulation"],
      markdown: "# AI\nNew rules coming",
      narration: "n",
      sources: [],
    });

    expect(repo.search("Ownership").map((brief) => brief.id)).toEqual([rust.id]);
    expect(repo.search("regulation").map((brief) => brief.id)).toEqual([ai.id]);
    expect(repo.search(undefined, 1)[0]?.id).toBe(ai.id);
    expect(repo.search(undefined, 10)).toHaveLength(2);
  });

  test("removes briefs and reports missing ones", () => {
    const repo = briefsRepo();
    const brief = repo.create({
      topics: ["Rust"],
      markdown: "# Rust",
      narration: "n",
      sources: [],
    });

    const removed = repo.remove(brief.id);
    expect(removed.id).toBe(brief.id);
    expect(repo.list()).toHaveLength(0);
    expect(repo.getAudio(brief.id)).toBeNull();
    expect(() => repo.remove(brief.id)).toThrow(/not found/);
  });
});

describe("WorkflowRunRepository", () => {
  test("removes runs and reports missing ones", () => {
    const repo = new WorkflowRunRepository(db());
    const run = repo.create({
      workflow: "briefing",
      contextId: "morning-briefing",
      trigger: "manual",
    });

    expect(repo.list()).toHaveLength(1);
    const removed = repo.remove(run.id);
    expect(removed.id).toBe(run.id);
    expect(repo.list()).toHaveLength(0);
    expect(() => repo.get(run.id)).toThrow(/not found/);
    expect(() => repo.remove(run.id)).toThrow(/not found/);
  });
});
