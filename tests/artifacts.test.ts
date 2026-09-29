import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { runMigrations } from "../src/infra/db/migrations.ts";

function repo(): ArtifactRepository {
  return new ArtifactRepository(new SqliteDatabase(":memory:"));
}

describe("ArtifactRepository", () => {
  test("stores text and binary artifacts with references", () => {
    const artifacts = repo();
    const brief = artifacts.create({
      kind: "brief",
      name: "Rust",
      contentType: "text/markdown",
      content: "# Rust",
      metadata: { topics: ["Rust"] },
      workflow: "briefing",
      correlationId: "c1",
    });
    const audio = artifacts.create({
      kind: "audio",
      contentType: "audio/ogg",
      data: new Uint8Array([1, 2, 3]),
      parentId: brief.id,
      workflow: "briefing",
      correlationId: "c1",
      metadata: { briefId: brief.id },
    });
    artifacts.updateMetadata(brief.id, { audioArtifactId: audio.id });

    const stored = artifacts.get(brief.id);
    expect(stored.kind).toBe("brief");
    expect(stored.name).toBe("Rust");
    expect(stored.content).toBe("# Rust");
    expect(stored.hasContent).toBe(true);
    expect(stored.hasData).toBe(false);
    expect(stored.data).toBeUndefined();
    expect(stored.metadata).toMatchObject({ topics: ["Rust"], audioArtifactId: audio.id });
    expect(stored.workflow).toBe("briefing");
    expect(stored.correlationId).toBe("c1");

    const withData = artifacts.get(audio.id, { includeData: true });
    expect(withData.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(withData.parentId).toBe(brief.id);
    expect(withData.byteSize).toBe(3);
  });

  test("lists by kind, workflow and parent", () => {
    const artifacts = repo();
    const brief = artifacts.create({
      kind: "brief",
      contentType: "text/markdown",
      content: "one",
      workflow: "briefing",
    });
    artifacts.create({
      kind: "audio",
      contentType: "audio/ogg",
      data: new Uint8Array([1]),
      parentId: brief.id,
      workflow: "briefing",
    });
    artifacts.create({ kind: "notes", contentType: "text/plain", content: "two", workflow: "other" });

    expect(artifacts.list({ kind: "brief" })).toHaveLength(1);
    expect(artifacts.list({ workflow: "briefing" })).toHaveLength(2);
    expect(artifacts.list({ parentId: brief.id })).toHaveLength(1);
    expect(artifacts.list()).toHaveLength(3);
  });

  test("searches content, name and metadata", () => {
    const artifacts = repo();
    artifacts.create({
      kind: "brief",
      contentType: "text/markdown",
      content: "Ownership news",
      metadata: { topics: ["Rust"] },
    });
    artifacts.create({
      kind: "brief",
      contentType: "text/markdown",
      content: "New rules coming",
      metadata: { topics: ["AI regulation"] },
    });

    expect(artifacts.search("Ownership", { kind: "brief" })).toHaveLength(1);
    expect(artifacts.search("regulation", { kind: "brief" })).toHaveLength(1);
    expect(artifacts.search("missing", { kind: "brief" })).toHaveLength(0);
    expect(artifacts.search(undefined, { kind: "brief", limit: 1 })).toHaveLength(1);
  });

  test("replaceData updates the blob in place", () => {
    const artifacts = repo();
    const audio = artifacts.create({
      kind: "audio",
      contentType: "audio/ogg",
      data: new Uint8Array([1]),
    });

    artifacts.replaceData(audio.id, new Uint8Array([9, 9]), "audio/mpeg");

    const stored = artifacts.get(audio.id, { includeData: true });
    expect(stored.data).toEqual(new Uint8Array([9, 9]));
    expect(stored.contentType).toBe("audio/mpeg");
    expect(stored.byteSize).toBe(2);
  });

  test("remove cascades to child artifacts", () => {
    const artifacts = repo();
    const parent = artifacts.create({ kind: "brief", contentType: "text/markdown", content: "x" });
    const child = artifacts.create({
      kind: "audio",
      contentType: "audio/ogg",
      data: new Uint8Array([1]),
      parentId: parent.id,
    });

    artifacts.remove(parent.id);

    expect(() => artifacts.get(child.id)).toThrow(/not found/);
    expect(artifacts.list()).toHaveLength(0);
  });
});

describe("artifact schema", () => {
  test("fresh databases only have the artifacts schema", () => {
    const db = new SqliteDatabase(":memory:");
    const tables = db.raw
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name);

    expect(tables).toContain("artifacts");
    expect(tables).not.toContain("briefs");
  });

  test("rejects pre-artifacts databases instead of half-migrating them", () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE briefs (
        id         TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        topics     TEXT NOT NULL,
        markdown   TEXT NOT NULL,
        narration  TEXT NOT NULL,
        sources    TEXT NOT NULL
      );
    `);

    expect(() => runMigrations(raw)).toThrow(/predates the artifacts schema/);
  });
});
