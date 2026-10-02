import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

/**
 * Anonymous read-only access to a single report: a delivery link carries the
 * token instead of assuming the receiver has a session.
 */
export interface ReportShareStore {
  /** The report's token, created on first use. */
  tokenFor(reportId: string): string;
  /** Report a token points at; null for unknown tokens. */
  reportIdFor(token: string): string | null;
  /** Drops a deleted report's token. */
  remove(reportId: string): void;
}

interface ShareRow {
  token: string;
  report_id: string;
}

export class ReportShareRepository implements ReportShareStore {
  constructor(private readonly db: SqliteDatabase) {}

  tokenFor(reportId: string): string {
    const existing = this.db.raw
      .query<ShareRow, [string]>("SELECT token, report_id FROM report_shares WHERE report_id = ?")
      .get(reportId);
    if (existing) return existing.token;

    const token = generateShareToken();
    this.db.raw
      .query("INSERT INTO report_shares (token, report_id, created_at) VALUES (?, ?, ?)")
      .run(token, reportId, Date.now());
    return token;
  }

  reportIdFor(token: string): string | null {
    const row = this.db.raw
      .query<ShareRow, [string]>("SELECT token, report_id FROM report_shares WHERE token = ?")
      .get(token);
    return row?.report_id ?? null;
  }

  remove(reportId: string): void {
    this.db.raw.query("DELETE FROM report_shares WHERE report_id = ?").run(reportId);
  }
}

/** URL-safe and unguessable: 122 random bits, no dashes. */
export function generateShareToken(): string {
  return crypto.randomUUID().replace(/-/g, "");
}
