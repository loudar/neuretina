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
    name: "contexts",
    sql: `
      CREATE TABLE IF NOT EXISTS contexts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        settings    TEXT NOT NULL DEFAULT '{}',
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO contexts (id, name, description, settings, created_at, updated_at)
      VALUES ('morning-briefing', 'Morning briefing', NULL, '{}', 0, 0);
    `,
  },
  {
    id: 3,
    name: "topics",
    sql: `
      CREATE TABLE IF NOT EXISTS topics (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        muted       INTEGER NOT NULL DEFAULT 0,
        context_id  TEXT NOT NULL DEFAULT 'morning-briefing',
        created_at  INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_topics_context ON topics (context_id);
    `,
  },
  {
    id: 4,
    name: "scheduled_jobs",
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        cron         TEXT NOT NULL,
        timezone     TEXT,
        workflow     TEXT NOT NULL,
        context_id   TEXT NOT NULL DEFAULT 'morning-briefing',
        input        TEXT NOT NULL DEFAULT '{}',
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        last_run_at  INTEGER,
        last_status  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_context ON scheduled_jobs (context_id);
    `,
  },
  {
    id: 5,
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
        context_id     TEXT NOT NULL DEFAULT 'morning-briefing',
        created_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_kind_created ON artifacts (kind, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_artifacts_parent ON artifacts (parent_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_correlation ON artifacts (correlation_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_context ON artifacts (context_id);
    `,
  },
  {
    id: 7,
    name: "workflow_runs",
    sql: `
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id             TEXT PRIMARY KEY,
        workflow       TEXT NOT NULL,
        context_id     TEXT NOT NULL,
        trigger        TEXT NOT NULL,
        trigger_detail TEXT NOT NULL DEFAULT '{}',
        status         TEXT NOT NULL,
        input          TEXT NOT NULL DEFAULT '{}',
        output         TEXT,
        error          TEXT,
        started_at     INTEGER NOT NULL,
        finished_at    INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_runs_context_started ON workflow_runs (context_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_workflow ON workflow_runs (workflow);
    `,
  },
  {
    id: 8,
    name: "workflow_run_cost",
    sql: `
      ALTER TABLE workflow_runs ADD COLUMN cost TEXT;
    `,
  },
  {
    id: 9,
    name: "status_entries",
    sql: `
      CREATE TABLE IF NOT EXISTS status_entries (
        id             TEXT PRIMARY KEY,
        activity_id    TEXT NOT NULL,
        correlation_id TEXT,
        parent_id      TEXT,
        text           TEXT NOT NULL,
        detail         TEXT,
        state          TEXT NOT NULL,
        cost_usd       REAL,
        started_at     INTEGER NOT NULL,
        updated_at     INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status_correlation ON status_entries (correlation_id);
      CREATE INDEX IF NOT EXISTS idx_status_updated ON status_entries (updated_at DESC);
    `,
  },
  {
    id: 10,
    name: "workflow_run_checkpoint",
    sql: `
      ALTER TABLE workflow_runs ADD COLUMN checkpoint TEXT;
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

  // The old briefs table predates the artifacts schema. There is no upgrade
  // path: wipe the database instead of half-migrating.
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
