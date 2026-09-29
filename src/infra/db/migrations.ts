import type { Database as BunDatabaseType } from "bun:sqlite";

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: 1,
    name: "events",
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        seq            INTEGER PRIMARY KEY AUTOINCREMENT,
        id             TEXT NOT NULL UNIQUE,
        topic          TEXT NOT NULL,
        ts             INTEGER NOT NULL,
        source         TEXT NOT NULL,
        correlation_id TEXT,
        payload        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_topic ON events (topic);
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
    `,
  },
  {
    id: 2,
    name: "topics",
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at  INTEGER NOT NULL
      );
    `,
  },
  {
    id: 3,
    name: "scheduled_jobs",
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        cron         TEXT NOT NULL,
        timezone     TEXT,
        workflow     TEXT NOT NULL,
        input        TEXT NOT NULL DEFAULT '{}',
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_run_at  INTEGER,
        last_status  TEXT
      );
    `,
  },
  {
    id: 4,
    name: "kv",
    sql: `
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 5,
    name: "topic-muted",
    sql: `
      ALTER TABLE topics ADD COLUMN muted INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    id: 6,
    name: "artifacts",
    sql: `
      CREATE TABLE IF NOT EXISTS artifacts (
        id             TEXT PRIMARY KEY,
        kind           TEXT NOT NULL,
        name           TEXT,
        content_type   TEXT NOT NULL,
        content        TEXT,
        data           BLOB,
        metadata       TEXT NOT NULL DEFAULT '{}',
        parent_id      TEXT,
        workflow       TEXT,
        correlation_id TEXT,
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_kind_created ON artifacts (kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts (parent_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_correlation ON artifacts (correlation_id);
    `,
  },
];

export function runMigrations(db: BunDatabaseType): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // The old briefs table predates the artifacts schema. Nothing is deployed
  // yet, so there is no upgrade path: wipe the database instead of half-migrating.
  const legacy = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'briefs'",
    )
    .get();
  if (legacy) {
    throw new Error(
      "This database predates the artifacts schema. Delete the database file and start fresh.",
    );
  }

  const applied = new Set(
    db
      .query<{ id: number }, []>("SELECT id FROM _migrations")
      .all()
      .map((row) => row.id),
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;

    const apply = db.transaction(() => {
      db.exec(migration.sql);
      db.query("INSERT INTO _migrations (id, name, applied_at) VALUES (?, ?, ?)").run(
        migration.id,
        migration.name,
        Date.now(),
      );
    });

    apply();
  }
}
