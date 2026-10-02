import type {
  StatusEntry,
  StatusKind,
  StatusState,
  StatusStore,
} from "../../core/status/StatusHub.ts";
import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

interface StatusRow {
  id: string;
  activity_id: string;
  correlation_id: string | null;
  parent_id: string | null;
  text: string;
  detail: string | null;
  kind: string | null;
  state: string;
  cost_usd: number | null;
  started_at: number;
  updated_at: number;
}

/** Rows kept before settled history is pruned. */
const PRUNE_KEEP = 1000;
/** Pruning is opportunistic; every Nth write is cheap enough. */
const PRUNE_EVERY = 100;

/** SQLite-backed status feed so run activity survives restarts. */
export class StatusRepository implements StatusStore {
  private writes = 0;

  constructor(private readonly db: SqliteDatabase) {}

  save(entry: StatusEntry): void {
    this.db.raw
      .query(
        `INSERT INTO status_entries
           (id, activity_id, correlation_id, parent_id, text, detail, kind, state, cost_usd, started_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           detail = excluded.detail,
           kind = excluded.kind,
           state = excluded.state,
           cost_usd = excluded.cost_usd,
           updated_at = excluded.updated_at`,
      )
      .run(
        entry.id,
        entry.activityId,
        entry.correlationId ?? null,
        entry.parentId ?? null,
        entry.text,
        entry.detail ?? null,
        entry.kind ?? null,
        entry.state,
        entry.costUsd ?? null,
        entry.startedAt,
        entry.updatedAt,
      );

    this.writes += 1;
    if (this.writes % PRUNE_EVERY === 0) this.prune();
  }

  /** Most recent entries in chronological order of creation. */
  load(limit = 200): StatusEntry[] {
    const rows = this.db.raw
      .query<StatusRow, [number]>(
        "SELECT * FROM status_entries ORDER BY started_at DESC, rowid DESC LIMIT ?",
      )
      .all(limit);
    return rows.reverse().map(toEntry);
  }

  removeByCorrelation(correlationId: string): void {
    this.db.raw.query("DELETE FROM status_entries WHERE correlation_id = ?").run(correlationId);
  }

  private prune(): void {
    this.db.raw
      .query(
        `DELETE FROM status_entries WHERE id NOT IN (
           SELECT id FROM status_entries ORDER BY updated_at DESC, rowid DESC LIMIT ?
         )`,
      )
      .run(PRUNE_KEEP);
  }
}

function toEntry(row: StatusRow): StatusEntry {
  return {
    id: row.id,
    activityId: row.activity_id,
    ...(row.correlation_id ? { correlationId: row.correlation_id } : {}),
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    text: row.text,
    ...(row.detail !== null ? { detail: row.detail } : {}),
    ...(row.kind !== null ? { kind: row.kind as StatusKind } : {}),
    state: row.state as StatusState,
    ...(row.cost_usd !== null ? { costUsd: row.cost_usd } : {}),
    startedAt: row.started_at,
    updatedAt: row.updated_at,
  };
}
