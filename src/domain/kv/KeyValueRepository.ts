import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

/** Storage-agnostic key/value store; swap the implementation freely. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  delete(key: string): void;
}

export class KeyValueRepository implements KeyValueStore {
  constructor(private readonly db: SqliteDatabase) {}

  get(key: string): string | null {
    const row = this.db.raw
      .query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?")
      .get(key);
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db.raw
      .query(
        `INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, Date.now());
  }

  delete(key: string): void {
    this.db.raw.query("DELETE FROM kv WHERE key = ?").run(key);
  }
}
