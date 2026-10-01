import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { ValidationError } from "../../core/errors.ts";

/** An account. Its data lives in its own database (the admin uses the main one). */
export interface User {
  id: string;
  displayName?: string;
  createdAt: number;
}

export interface UserStore {
  list(): User[];
  get(id: string): User | undefined;
  ensure(id: string, displayName?: string): User;
  remove(id: string): void;
  count(): number;
}

/** Also used as the database file name, so keep it filesystem-safe. */
export const USER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function normalizeUserId(value: string): string {
  const id = value.trim();
  if (!USER_ID_PATTERN.test(id)) {
    throw new ValidationError(
      `User id must be 1-64 characters of letters, digits, ".", "_" or "-" (got "${value}")`,
    );
  }
  return id;
}

interface UserRow {
  id: string;
  display_name: string | null;
  created_at: number;
}

export class UserRepository implements UserStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(): User[] {
    return this.db.raw
      .query<UserRow, []>("SELECT * FROM users ORDER BY created_at ASC, id ASC")
      .all()
      .map(toUser);
  }

  get(id: string): User | undefined {
    const row = this.db.raw
      .query<UserRow, [string]>("SELECT * FROM users WHERE id = ?")
      .get(id);
    return row ? toUser(row) : undefined;
  }

  ensure(id: string, displayName?: string): User {
    const userId = normalizeUserId(id);
    const existing = this.get(userId);
    if (existing) return existing;

    const createdAt = Date.now();
    this.db.raw
      .query("INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)")
      .run(userId, displayName ?? null, createdAt);
    return { id: userId, displayName, createdAt };
  }

  remove(id: string): void {
    this.db.raw.query("DELETE FROM users WHERE id = ?").run(id);
  }

  count(): number {
    const row = this.db.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM users")
      .get();
    return row?.n ?? 0;
  }
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name ?? undefined,
    createdAt: row.created_at,
  };
}
