import { NotFoundError } from "../../core/errors.ts";
import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

/** The context the engine ships with; owns the briefing topics/jobs/artifacts. */
export const DEFAULT_CONTEXT_ID = "morning-briefing";
export const DEFAULT_CONTEXT_NAME = "Morning briefing";

/**
 * A named scope a workflow runs in: it owns topics, scheduled jobs and the
 * artifacts its runs produce, plus per-context settings.
 */
export interface AppContext {
  id: string;
  name: string;
  description?: string;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CreateContextInput {
  id?: string;
  name: string;
  description?: string;
  settings?: Record<string, unknown>;
}

/** Storage-agnostic context store; swap the implementation without touching consumers. */
export interface ContextStore {
  list(): AppContext[];
  get(id: string): AppContext;
  create(input: CreateContextInput): AppContext;
  /** Creates the context when missing (used to seed the default one). */
  ensure(input: CreateContextInput): AppContext;
}

interface ContextRow {
  id: string;
  name: string;
  description: string | null;
  settings: string;
  created_at: number;
  updated_at: number;
}

export class ContextRepository implements ContextStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(): AppContext[] {
    const rows = this.db.raw
      .query<ContextRow, []>("SELECT * FROM contexts ORDER BY created_at ASC")
      .all();
    return rows.map(toContext);
  }

  get(id: string): AppContext {
    const row = this.db.raw
      .query<ContextRow, [string]>("SELECT * FROM contexts WHERE id = ?")
      .get(id);
    if (!row) throw new NotFoundError(`Context ${id} not found`);
    return toContext(row);
  }

  create(input: CreateContextInput): AppContext {
    const now = Date.now();
    const context: AppContext = {
      id: input.id ?? crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      settings: input.settings ?? {},
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO contexts (id, name, description, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        context.id,
        context.name,
        context.description ?? null,
        JSON.stringify(context.settings),
        context.createdAt,
        context.updatedAt,
      );

    return context;
  }

  ensure(input: CreateContextInput): AppContext {
    const id = input.id ?? crypto.randomUUID();
    const existing = this.db.raw
      .query<ContextRow, [string]>("SELECT * FROM contexts WHERE id = ?")
      .get(id);
    return existing ? toContext(existing) : this.create({ ...input, id });
  }
}

function toContext(row: ContextRow): AppContext {
  let settings: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.settings);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      settings = parsed as Record<string, unknown>;
    }
  } catch {
    settings = {};
  }

  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    settings,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
