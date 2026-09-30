import { NotFoundError } from "../../core/errors.ts";
import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

export type TriggerKind = "schedule" | "matrix" | "manual";
export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "skipped";

/** One execution of a workflow: what started it, what it produced, how it ended. */
export interface WorkflowRun {
  id: string;
  workflow: string;
  contextId: string;
  trigger: TriggerKind;
  /** Trigger-specific origin, e.g. `{ jobId }` or `{ channel, sender, eventId }`. */
  triggerDetail: Record<string, unknown>;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  /** Provider cost report for the run (JSON), when anything metered was used. */
  cost?: unknown;
  startedAt: number;
  finishedAt?: number;
}

export interface CreateWorkflowRunInput {
  /** Defaults to a fresh uuid; the id doubles as the run's correlation id. */
  id?: string;
  workflow: string;
  contextId: string;
  trigger: TriggerKind;
  triggerDetail?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

export interface ListWorkflowRunsOptions {
  contextId?: string;
  workflow?: string;
  limit?: number;
}

/** Storage-agnostic run store; swap the implementation without touching consumers. */
export interface WorkflowRunStore {
  create(input: CreateWorkflowRunInput): WorkflowRun;
  get(id: string): WorkflowRun;
  list(options?: ListWorkflowRunsOptions): WorkflowRun[];
  latest(contextId?: string): WorkflowRun | null;
  finish(id: string, patch: { status: WorkflowRunStatus; output?: unknown; error?: string }): WorkflowRun;
  /** Removes the run record; artifacts are handled by the caller. */
  remove(id: string): WorkflowRun;
}

interface RunRow {
  id: string;
  workflow: string;
  context_id: string;
  trigger: string;
  trigger_detail: string;
  status: string;
  input: string;
  output: string | null;
  error: string | null;
  cost: string | null;
  started_at: number;
  finished_at: number | null;
}

export class WorkflowRunRepository implements WorkflowRunStore {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateWorkflowRunInput): WorkflowRun {
    const run: WorkflowRun = {
      id: input.id ?? crypto.randomUUID(),
      workflow: input.workflow,
      contextId: input.contextId,
      trigger: input.trigger,
      triggerDetail: input.triggerDetail ?? {},
      status: "running",
      input: input.input ?? {},
      startedAt: Date.now(),
    };

    this.db.raw
      .query(
        `INSERT INTO workflow_runs
           (id, workflow, context_id, trigger, trigger_detail, status, input, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.workflow,
        run.contextId,
        run.trigger,
        JSON.stringify(run.triggerDetail),
        run.status,
        JSON.stringify(run.input),
        run.startedAt,
      );

    return run;
  }

  get(id: string): WorkflowRun {
    const row = this.db.raw
      .query<RunRow, [string]>("SELECT * FROM workflow_runs WHERE id = ?")
      .get(id);
    if (!row) throw new NotFoundError(`Workflow run ${id} not found`);
    return toRun(row);
  }

  list(options: ListWorkflowRunsOptions = {}): WorkflowRun[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (options.contextId) {
      conditions.push("context_id = ?");
      params.push(options.contextId);
    }
    if (options.workflow) {
      conditions.push("workflow = ?");
      params.push(options.workflow);
    }

    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 500);
    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db.raw
      .query<RunRow, Array<string | number>>(
        `SELECT * FROM workflow_runs ${where} ORDER BY started_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params);
    return rows.map(toRun);
  }

  latest(contextId?: string): WorkflowRun | null {
    return this.list({ contextId, limit: 1 })[0] ?? null;
  }

  finish(
    id: string,
    patch: { status: WorkflowRunStatus; output?: unknown; error?: string; cost?: unknown },
  ): WorkflowRun {
    const result = this.db.raw
      .query(
        `UPDATE workflow_runs
         SET status = ?, output = ?, error = ?, cost = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.status,
        patch.output === undefined ? null : JSON.stringify(patch.output ?? null),
        patch.error ?? null,
        patch.cost === undefined ? null : JSON.stringify(patch.cost ?? null),
        Date.now(),
        id,
      );
    if (result.changes === 0) throw new NotFoundError(`Workflow run ${id} not found`);
    return this.get(id);
  }

  /** Removes the run record; artifacts are handled by the caller. */
  remove(id: string): WorkflowRun {
    const run = this.get(id);
    this.db.raw.query("DELETE FROM workflow_runs WHERE id = ?").run(id);
    return run;
  }
}

function toRun(row: RunRow): WorkflowRun {
  return {
    id: row.id,
    workflow: row.workflow,
    contextId: row.context_id,
    trigger: row.trigger as TriggerKind,
    triggerDetail: parseJson(row.trigger_detail, {}),
    status: row.status as WorkflowRunStatus,
    input: parseJson(row.input, {}),
    output: row.output === null ? undefined : parseJson(row.output, null),
    error: row.error ?? undefined,
    cost: row.cost === null ? undefined : parseJson(row.cost, null),
    startedAt: row.started_at,
    finishedAt: row.finished_at ?? undefined,
  };
}

function parseJson(value: string, fallback: unknown): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return (fallback ?? {}) as Record<string, unknown>;
  } catch {
    return (fallback ?? {}) as Record<string, unknown>;
  }
}
