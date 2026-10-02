import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";
import { parseJsonObject } from "../../core/json.ts";

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
  /** Step id the run stops after; later steps never start. */
  stopAfter?: string;
  createdAt: number;
  updatedAt: number;
}

/** Storage-agnostic user workflow store; swap the implementation freely. */
export interface UserWorkflowStore {
  list(): UserWorkflow[];
  /** Null (instead of throwing) so callers can enrich optional lookups. */
  get(id: string): UserWorkflow | null;
  add(input: { name: string; inputs: Record<string, unknown>; stopAfter?: string }): UserWorkflow;
  /**
   * Inserts or updates the row under an explicit id; customizations of a
   * built-in workflow are keyed by the built-in's own id.
   */
  upsert(
    id: string,
    input: { name: string; inputs: Record<string, unknown>; stopAfter?: string },
  ): UserWorkflow;
  /** `stopAfter: null` clears the stop step; `undefined` leaves it unchanged. */
  update(
    id: string,
    patch: { name?: string; inputs?: Record<string, unknown>; stopAfter?: string | null },
  ): UserWorkflow;
  remove(id: string): UserWorkflow;
  count(): number;
}

interface UserWorkflowRow {
  id: string;
  name: string;
  inputs: string;
  stop_after: string | null;
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

  add(input: {
    name: string;
    inputs: Record<string, unknown>;
    stopAfter?: string;
  }): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");
    const stopAfter = normalizeStopAfter(input.stopAfter);

    const now = Date.now();
    const workflow: UserWorkflow = {
      id: crypto.randomUUID(),
      name,
      inputs: normalizeInputs(input.inputs),
      ...(stopAfter ? { stopAfter } : {}),
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, inputs, stop_after, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflow.id,
        workflow.name,
        JSON.stringify(workflow.inputs),
        stopAfter ?? null,
        workflow.createdAt,
        workflow.updatedAt,
      );

    return workflow;
  }

  upsert(
    id: string,
    input: { name: string; inputs: Record<string, unknown>; stopAfter?: string },
  ): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");
    const stopAfter = normalizeStopAfter(input.stopAfter);

    const now = Date.now();
    const existing = this.get(id);
    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, inputs, stop_after, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           inputs = excluded.inputs,
           stop_after = excluded.stop_after,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        name,
        JSON.stringify(normalizeInputs(input.inputs)),
        stopAfter ?? null,
        existing?.createdAt ?? now,
        now,
      );

    return this.get(id)!;
  }

  update(
    id: string,
    patch: { name?: string; inputs?: Record<string, unknown>; stopAfter?: string | null },
  ): UserWorkflow {
    const existing = this.get(id);
    if (!existing) throw new NotFoundError(`User workflow ${id} not found`);

    const name = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!name) throw new ValidationError("User workflow name is required");
    const inputs = patch.inputs !== undefined ? normalizeInputs(patch.inputs) : existing.inputs;
    const stopAfter =
      patch.stopAfter === undefined ? existing.stopAfter : normalizeStopAfter(patch.stopAfter);

    this.db.raw
      .query(
        "UPDATE user_workflows SET name = ?, inputs = ?, stop_after = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, JSON.stringify(inputs), stopAfter ?? null, Date.now(), id);

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

function normalizeStopAfter(value: string | null | undefined): string | undefined {
  const step = value?.trim();
  return step ? step : undefined;
}

function toUserWorkflow(row: UserWorkflowRow): UserWorkflow {
  const inputs = parseJsonObject(row.inputs);

  return {
    id: row.id,
    name: row.name,
    inputs,
    ...(row.stop_after ? { stopAfter: row.stop_after } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
