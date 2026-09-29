import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";

export interface Topic {
  id: string;
  name: string;
  description?: string;
  /** Muted topics are excluded from briefings until unmuted. */
  muted: boolean;
  createdAt: number;
}

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  muted: number;
  created_at: number;
}

/** Storage-agnostic topic store; swap the implementation without touching consumers. */
export interface TopicStore {
  list(): Topic[];
  /** Topics that participate in briefings (muted ones are excluded). */
  listActive(): Topic[];
  get(id: string): Topic;
  add(input: { name: string; description?: string }): Topic;
  update(id: string, patch: { name?: string; description?: string; muted?: boolean }): Topic;
  remove(id: string): Topic;
}

export class TopicRepository implements TopicStore {
  constructor(private readonly db: SqliteDatabase) {}

  list(): Topic[] {
    const rows = this.db.raw
      .query<TopicRow, []>("SELECT * FROM topics ORDER BY name COLLATE NOCASE ASC")
      .all();
    return rows.map(toTopic);
  }

  /** Topics that participate in briefings (muted ones are excluded). */
  listActive(): Topic[] {
    return this.list().filter((topic) => !topic.muted);
  }

  get(id: string): Topic {
    const row = this.db.raw.query<TopicRow, [string]>("SELECT * FROM topics WHERE id = ?").get(id);
    if (!row) throw new NotFoundError(`Topic ${id} not found`);
    return toTopic(row);
  }

  add(input: { name: string; description?: string }): Topic {
    const topic: Topic = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      muted: false,
      createdAt: Date.now(),
    };

    try {
      this.db.raw
        .query("INSERT INTO topics (id, name, description, muted, created_at) VALUES (?, ?, ?, ?, ?)")
        .run(topic.id, topic.name, topic.description ?? null, 0, topic.createdAt);
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
    createdAt: row.created_at,
  };
}
