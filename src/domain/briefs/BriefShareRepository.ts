import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

/**
 * Anonymous read-only access to a single brief: a delivery link carries the
 * token instead of assuming the receiver has a session.
 */
export interface BriefShareStore {
  /** The brief's token, created on first use. */
  tokenFor(briefId: string): string;
  /** Brief a token points at; null for unknown tokens. */
  briefIdFor(token: string): string | null;
  /** Drops a deleted brief's token. */
  remove(briefId: string): void;
}

interface ShareRow {
  token: string;
  brief_id: string;
}

export class BriefShareRepository implements BriefShareStore {
  constructor(private readonly db: SqliteDatabase) {}

  tokenFor(briefId: string): string {
    const existing = this.db.raw
      .query<ShareRow, [string]>("SELECT token, brief_id FROM brief_shares WHERE brief_id = ?")
      .get(briefId);
    if (existing) return existing.token;

    const token = generateShareToken();
    this.db.raw
      .query("INSERT INTO brief_shares (token, brief_id, created_at) VALUES (?, ?, ?)")
      .run(token, briefId, Date.now());
    return token;
  }

  briefIdFor(token: string): string | null {
    const row = this.db.raw
      .query<ShareRow, [string]>("SELECT token, brief_id FROM brief_shares WHERE token = ?")
      .get(token);
    return row?.brief_id ?? null;
  }

  remove(briefId: string): void {
    this.db.raw.query("DELETE FROM brief_shares WHERE brief_id = ?").run(briefId);
  }
}

/** URL-safe and unguessable: 122 random bits, no dashes. */
export function generateShareToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
