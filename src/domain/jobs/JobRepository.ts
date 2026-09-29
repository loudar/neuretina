import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";
import { DEFAULT_CONTEXT_ID } from "../contexts/ContextRepository.ts";

export type JobRunStatus = "success" | "failed";

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  workflow: string;
  /** Context the triggered run belongs to. */
  contextId: string;
  input: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: JobRunStatus;
}

export interface CreateJobInput {
  name: string;
  cron: string;
  timezone?: string;
  workflow: string;
  contextId?: string;
  input?: Record<string, unknown>;
  enabled?: boolean;
}

export type UpdateJobInput = Partial<Omit<CreateJobInput, "workflow">>;

interface JobRow {
  id: string;
  name: string;
  cron: string;
  timezone: string | null;
  workflow: string;
  context_id: string;
  input: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_status: string | null;
}

/** Storage-agnostic job store; swap the implementation without touching consumers. */
export interface JobStore {
  list(): ScheduledJob[];
  listEnabled(): ScheduledJob[];
  get(id: string): ScheduledJob;
  create(input: CreateJobInput): ScheduledJob;
  update(id: string, patch: UpdateJobInput): ScheduledJob;
  setRunResult(id: string, status: JobRunStatus, at: number): void;
  remove(id: string): ScheduledJob;
  count(): number;
}

export class JobRepository implements JobStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(): ScheduledJob[] {
    const rows = this.db.raw
      .query<JobRow, []>("SELECT * FROM scheduled_jobs ORDER BY created_at ASC")
      .all();
    return rows.map(toJob);
  }

  listEnabled(): ScheduledJob[] {
    return this.list().filter((job) => job.enabled);
  }

  get(id: string): ScheduledJob {
    const row = this.db.raw
      .query<JobRow, [string]>("SELECT * FROM scheduled_jobs WHERE id = ?")
      .get(id);
    if (!row) throw new NotFoundError(`Job ${id} not found`);
    return toJob(row);
  }

  create(input: CreateJobInput): ScheduledJob {
    const now = Date.now();
    const job: ScheduledJob = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      cron: input.cron.trim(),
      timezone: input.timezone,
      workflow: input.workflow,
      contextId: input.contextId ?? DEFAULT_CONTEXT_ID,
      input: input.input ?? {},
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO scheduled_jobs (id, name, cron, timezone, workflow, context_id, input, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.id,
        job.name,
        job.cron,
        job.timezone ?? null,
        job.workflow,
        job.contextId,
        JSON.stringify(job.input),
        job.enabled ? 1 : 0,
        job.createdAt,
        job.updatedAt,
      );

    return job;
  }

  update(id: string, patch: UpdateJobInput): ScheduledJob {
    const existing = this.get(id);
    const updated: ScheduledJob = {
      ...existing,
      name: patch.name?.trim() ?? existing.name,
      cron: patch.cron?.trim() ?? existing.cron,
      timezone: patch.timezone !== undefined ? patch.timezone : existing.timezone,
      input: patch.input ?? existing.input,
      enabled: patch.enabled ?? existing.enabled,
      updatedAt: Date.now(),
    };

    this.db.raw
      .query(
        `UPDATE scheduled_jobs
         SET name = ?, cron = ?, timezone = ?, input = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        updated.name,
        updated.cron,
        updated.timezone ?? null,
        JSON.stringify(updated.input),
        updated.enabled ? 1 : 0,
        updated.updatedAt,
        id,
      );

    return updated;
  }

  setRunResult(id: string, status: JobRunStatus, at: number): void {
    this.db.raw
      .query("UPDATE scheduled_jobs SET last_run_at = ?, last_status = ? WHERE id = ?")
      .run(at, status, id);
  }

  remove(id: string): ScheduledJob {
    const job = this.get(id);
    this.db.raw.query("DELETE FROM scheduled_jobs WHERE id = ?").run(id);
    return job;
  }

  count(): number {
    const row = this.db.raw
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scheduled_jobs")
      .get();
    return row?.n ?? 0;
  }
}

function toJob(row: JobRow): ScheduledJob {
  let parsedInput: Record<string, unknown> = {};
  try {
    parsedInput = JSON.parse(row.input) as Record<string, unknown>;
  } catch {
    parsedInput = {};
  }

  return {
    id: row.id,
    name: row.name,
    cron: row.cron,
    timezone: row.timezone ?? undefined,
    workflow: row.workflow,
    contextId: row.context_id,
    input: parsedInput,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at ?? undefined,
    lastStatus: (row.last_status as JobRunStatus | null) ?? undefined,
  };
}

export function assertJobInput(input: CreateJobInput): void {
  if (!input.name?.trim()) throw new ValidationError("Job name is required");
  if (!input.cron?.trim()) throw new ValidationError("Job cron expression is required");
  if (!input.workflow?.trim()) throw new ValidationError("Job workflow is required");
}
