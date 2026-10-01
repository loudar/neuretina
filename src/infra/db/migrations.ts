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
  {
    id: 11,
    name: "delivery_channels",
    sql: `
      CREATE TABLE IF NOT EXISTS delivery_channels (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL,
        name       TEXT NOT NULL,
        config     TEXT NOT NULL DEFAULT '{}',
        enabled    INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS workflow_delivery_channels (
        workflow   TEXT NOT NULL,
        channel_id TEXT NOT NULL REFERENCES delivery_channels(id) ON DELETE CASCADE,
        PRIMARY KEY (workflow, channel_id)
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id         TEXT PRIMARY KEY,
        brief_id   TEXT NOT NULL,
        run_id     TEXT,
        channel_id TEXT NOT NULL,
        kind       TEXT NOT NULL,
        status     TEXT NOT NULL,
        event_id   TEXT,
        error      TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_deliveries_brief ON deliveries (brief_id);
      CREATE INDEX IF NOT EXISTS idx_deliveries_run ON deliveries (run_id);
      CREATE INDEX IF NOT EXISTS idx_deliveries_channel ON deliveries (channel_id);
    `,
  },
  {
    id: 12,
    name: "user_workflows",
    sql: `
      CREATE TABLE IF NOT EXISTS user_workflows (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        topics     TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `,
  },
  {
    // Briefs produced through a user workflow used to be stored with the
    // pipeline's id ("briefing") instead of the workflow that was run; the
    // run is the source of truth (delivery already resolved through it).
    id: 13,
    name: "repair_brief_workflow_attribution",
    sql: `
      UPDATE artifacts
      SET workflow = (
        SELECT workflow_runs.workflow
        FROM workflow_runs
        WHERE workflow_runs.id = artifacts.correlation_id
      )
      WHERE kind IN ('brief', 'audio')
        AND correlation_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM workflow_runs
          WHERE workflow_runs.id = artifacts.correlation_id
            AND workflow_runs.workflow IS NOT artifacts.workflow
        );
    `,
  },
  {
    // Delivery channels attach to a workflow step *output* (e.g. the brief's
    // text, the voice message), not to the workflow itself. Legacy rows keep
    // empty step/output until the kernel expands them onto the definition's
    // deliverable outputs at boot.
    id: 14,
    name: "delivery_step_targets",
    sql: `
      CREATE TABLE workflow_delivery_targets (
        workflow   TEXT NOT NULL,
        step       TEXT NOT NULL DEFAULT '',
        output     TEXT NOT NULL DEFAULT '',
        channel_id TEXT NOT NULL REFERENCES delivery_channels(id) ON DELETE CASCADE,
        PRIMARY KEY (workflow, step, output, channel_id)
      );
      INSERT OR IGNORE INTO workflow_delivery_targets (workflow, step, output, channel_id)
        SELECT workflow, '', '', channel_id FROM workflow_delivery_channels;
      DROP TABLE workflow_delivery_channels;
      ALTER TABLE workflow_delivery_targets RENAME TO workflow_delivery_channels;
    `,
  },
  {
    // Workflow configuration moves from the fixed topic list to generic input
    // values keyed by input id (`{"topics": ["…"]}` for the topics input).
    id: 15,
    name: "user_workflow_inputs",
    sql: `
      ALTER TABLE user_workflows ADD COLUMN inputs TEXT NOT NULL DEFAULT '{}';
      UPDATE user_workflows
      SET inputs = CASE
        WHEN topics IS NOT NULL AND json_valid(topics) AND json_type(topics) = 'array'
          THEN json_object('topics', json(topics))
        ELSE '{}'
      END;
      ALTER TABLE user_workflows DROP COLUMN topics;
    `,
  },
  {
    // Dated events extracted from briefs (the `events` table is the event
    // log). Events are rows, not artifacts: a timeline artifact is composed
    // of a set of them.
    id: 16,
    name: "timeline_events",
    sql: `
      CREATE TABLE IF NOT EXISTS timeline_events (
        id              TEXT PRIMARY KEY,
        date            TEXT NOT NULL,
        time            TEXT,
        entities        TEXT NOT NULL DEFAULT '[]',
        tags            TEXT NOT NULL DEFAULT '[]',
        title           TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        source_brief_id TEXT,
        created_at      INTEGER NOT NULL,
        updated_at      INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_events_date ON timeline_events (date);
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
