import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";
import { DEFAULT_CONTEXT_ID } from "../contexts/ContextRepository.ts";

export interface Topic {
  id: string;
  name: string;
  description?: string;
  /** Muted topics are excluded from briefings until unmuted. */
  muted: boolean;
  /** Context this topic belongs to. */
  contextId: string;
  createdAt: number;
}

/** Storage-agnostic topic store; swap the implementation without touching consumers. */
export interface TopicStore {
  /** All topics, or only those of one context. */
  list(contextId?: string): Topic[];
  /** Topics that participate in briefings (muted ones are excluded). */
  listActive(contextId?: string): Topic[];
  get(id: string): Topic;
  add(input: { name: string; description?: string; contextId?: string }): Topic;
  update(id: string, patch: { name?: string; description?: string; muted?: boolean }): Topic;
  remove(id: string): Topic;
}

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  muted: number;
  context_id: string;
  created_at: number;
}

export class TopicRepository implements TopicStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(contextId?: string): Topic[] {
    const rows = contextId
      ? this.db.raw
          .query<TopicRow, [string]>(
            "SELECT * FROM topics WHERE context_id = ? ORDER BY name COLLATE NOCASE ASC",
          )
          .all(contextId)
      : this.db.raw
          .query<TopicRow, []>("SELECT * FROM topics ORDER BY name COLLATE NOCASE ASC")
          .all();
    return rows.map(toTopic);
  }

  /** Topics that participate in briefings (muted ones are excluded). */
  listActive(contextId?: string): Topic[] {
    return this.list(contextId).filter((topic) => !topic.muted);
  }

  get(id: string): Topic {
    const row = this.db.raw.query<TopicRow, [string]>("SELECT * FROM topics WHERE id = ?").get(id);
    if (!row) throw new NotFoundError(`Topic ${id} not found`);
    return toTopic(row);
  }

  add(input: { name: string; description?: string; contextId?: string }): Topic {
    const topic: Topic = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      muted: false,
      contextId: input.contextId ?? DEFAULT_CONTEXT_ID,
      createdAt: Date.now(),
    };

    try {
      this.db.raw
        .query(
          "INSERT INTO topics (id, name, description, muted, context_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(
          topic.id,
          topic.name,
          topic.description ?? null,
          0,
          topic.contextId,
          topic.createdAt,
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ValidationError(`A topic named "${topic.name}" already exists`);
      }
      throw error;
    }

    return topic;
  }

  update(id: string, patch: { name?: string; description?: string; muted?: boolean }): Topic {
    const existing = this.get(id);
    const name = patch.name?.trim() || existing.name;
    const description =
      patch.description !== undefined ? patch.description.trim() || undefined : existing.description;
    const muted = patch.muted ?? existing.muted;

    try {
      this.db.raw
        .query("UPDATE topics SET name = ?, description = ?, muted = ? WHERE id = ?")
        .run(name, description ?? null, muted ? 1 : 0, id);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ValidationError(`A topic named "${name}" already exists`);
      }
      throw error;
    }

    return this.get(id);
  }

  remove(id: string): Topic {
    const topic = this.get(id);
    this.db.raw.query("DELETE FROM topics WHERE id = ?").run(id);
    return topic;
  }
}

function toTopic(row: TopicRow): Topic {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    muted: row.muted === 1,
    contextId: row.context_id,
    createdAt: row.created_at,
  };
}
