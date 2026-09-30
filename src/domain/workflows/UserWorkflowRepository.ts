import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";

/**
 * A user-created workflow instance: the pipeline runs over the configured
 * input values ({ topics: [...] } today) and delivers through the channels
 * assigned to its step outputs.
 */
export interface UserWorkflow {
  id: string;
  name: string;
  /** Configured input values keyed by input id, e.g. `{ topics: ["t1"] }`. */
  inputs: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/** Storage-agnostic user workflow store; swap the implementation freely. */
export interface UserWorkflowStore {
  list(): UserWorkflow[];
  /** Null (instead of throwing) so callers can enrich optional lookups. */
  get(id: string): UserWorkflow | null;
  add(input: { name: string; inputs: Record<string, unknown> }): UserWorkflow;
  /**
   * Inserts or updates the row under an explicit id; customizations of a
   * built-in workflow are keyed by the built-in's own id.
   */
  upsert(id: string, input: { name: string; inputs: Record<string, unknown> }): UserWorkflow;
  update(
    id: string,
    patch: { name?: string; inputs?: Record<string, unknown> },
  ): UserWorkflow;
  remove(id: string): UserWorkflow;
  count(): number;
}

interface UserWorkflowRow {
  id: string;
  name: string;
  inputs: string;
  created_at: number;
  updated_at: number;
}

export class UserWorkflowRepository implements UserWorkflowStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(): UserWorkflow[] {
    const rows = this.db.raw
      .query<UserWorkflowRow, []>("SELECT * FROM user_workflows ORDER BY created_at ASC")
      .all();
    return rows.map(toUserWorkflow);
  }

  get(id: string): UserWorkflow | null {
    const row = this.db.raw
      .query<UserWorkflowRow, [string]>("SELECT * FROM user_workflows WHERE id = ?")
      .get(id);
    return row ? toUserWorkflow(row) : null;
  }

  add(input: { name: string; inputs: Record<string, unknown> }): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");

    const now = Date.now();
    const workflow: UserWorkflow = {
      id: crypto.randomUUID(),
      name,
      inputs: normalizeInputs(input.inputs),
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, inputs, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        workflow.id,
        workflow.name,
        JSON.stringify(workflow.inputs),
        workflow.createdAt,
        workflow.updatedAt,
      );

    return workflow;
  }

  upsert(id: string, input: { name: string; inputs: Record<string, unknown> }): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");

    const now = Date.now();
    const existing = this.get(id);
    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, inputs, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           inputs = excluded.inputs,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        name,
        JSON.stringify(normalizeInputs(input.inputs)),
        existing?.createdAt ?? now,
        now,
      );

    return this.get(id)!;
  }

  update(
    id: string,
    patch: { name?: string; inputs?: Record<string, unknown> },
  ): UserWorkflow {
    const existing = this.get(id);
    if (!existing) throw new NotFoundError(`User workflow ${id} not found`);

    const name = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!name) throw new ValidationError("User workflow name is required");
    const inputs = patch.inputs !== undefined ? normalizeInputs(patch.inputs) : existing.inputs;

    this.db.raw
      .query("UPDATE user_workflows SET name = ?, inputs = ?, updated_at = ? WHERE id = ?")
      .run(name, JSON.stringify(inputs), Date.now(), id);

    return this.get(id)!;
  }

  remove(id: string): UserWorkflow {
    const existing = this.get(id);
    if (!existing) throw new NotFoundError(`User workflow ${id} not found`);
    this.db.raw.query("DELETE FROM user_workflows WHERE id = ?").run(id);
    return existing;
  }

  count(): number {
    const row = this.db.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM user_workflows")
      .get();
    return row?.n ?? 0;
  }
}

function normalizeInputs(inputs: Record<string, unknown>): Record<string, unknown> {
  return { ...inputs };
}

function toUserWorkflow(row: UserWorkflowRow): UserWorkflow {
  let inputs: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(row.inputs) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      inputs = parsed as Record<string, unknown>;
    }
  } catch {
    inputs = {};
  }

  return {
    id: row.id,
    name: row.name,
    inputs,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
