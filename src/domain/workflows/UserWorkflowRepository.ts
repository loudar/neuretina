import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";

/**
 * A user-created briefing instance: the pipeline runs over the selected
 * topics and delivers through the channels attached to its id.
 */
export interface UserWorkflow {
  id: string;
  name: string;
  topicIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** Storage-agnostic user workflow store; swap the implementation freely. */
export interface UserWorkflowStore {
  list(): UserWorkflow[];
  /** Null (instead of throwing) so callers can enrich optional lookups. */
  get(id: string): UserWorkflow | null;
  add(input: { name: string; topicIds: string[] }): UserWorkflow;
  /**
   * Inserts or updates the row under an explicit id; customizations of a
   * built-in workflow are keyed by the built-in's own id.
   */
  upsert(id: string, input: { name: string; topicIds: string[] }): UserWorkflow;
  update(id: string, patch: { name?: string; topicIds?: string[] }): UserWorkflow;
  remove(id: string): UserWorkflow;
  count(): number;
}

interface UserWorkflowRow {
  id: string;
  name: string;
  topics: string;
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

  add(input: { name: string; topicIds: string[] }): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");

    const now = Date.now();
    const workflow: UserWorkflow = {
      id: crypto.randomUUID(),
      name,
      topicIds: normalizeTopicIds(input.topicIds),
      createdAt: now,
      updatedAt: now,
    };

    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, topics, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        workflow.id,
        workflow.name,
        JSON.stringify(workflow.topicIds),
        workflow.createdAt,
        workflow.updatedAt,
      );

    return workflow;
  }

  upsert(id: string, input: { name: string; topicIds: string[] }): UserWorkflow {
    const name = input.name.trim();
    if (!name) throw new ValidationError("User workflow name is required");

    const now = Date.now();
    const existing = this.get(id);
    this.db.raw
      .query(
        `INSERT INTO user_workflows (id, name, topics, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           topics = excluded.topics,
           updated_at = excluded.updated_at`,
      )
      .run(
        id,
        name,
        JSON.stringify(normalizeTopicIds(input.topicIds)),
        existing?.createdAt ?? now,
        now,
      );

    return this.get(id)!;
  }

  update(id: string, patch: { name?: string; topicIds?: string[] }): UserWorkflow {
    const existing = this.get(id);
    if (!existing) throw new NotFoundError(`User workflow ${id} not found`);

    const name = patch.name !== undefined ? patch.name.trim() : existing.name;
    if (!name) throw new ValidationError("User workflow name is required");
    const topicIds =
      patch.topicIds !== undefined ? normalizeTopicIds(patch.topicIds) : existing.topicIds;

    this.db.raw
      .query("UPDATE user_workflows SET name = ?, topics = ?, updated_at = ? WHERE id = ?")
      .run(name, JSON.stringify(topicIds), Date.now(), id);

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

function normalizeTopicIds(topicIds: string[]): string[] {
  return [...new Set(topicIds.map((id) => id.trim()).filter(Boolean))];
}

function toUserWorkflow(row: UserWorkflowRow): UserWorkflow {
  let topicIds: string[] = [];
  try {
    const parsed = JSON.parse(row.topics) as unknown;
    if (Array.isArray(parsed)) {
      topicIds = parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    topicIds = [];
  }

  return {
    id: row.id,
    name: row.name,
    topicIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
