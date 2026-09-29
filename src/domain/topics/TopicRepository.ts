import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError, ValidationError } from "../../core/errors.ts";

export interface Topic {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

interface TopicRow {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
}

export class TopicRepository {
  constructor(private readonly db: SqliteDatabase) {}

  list(): Topic[] {
    const rows = this.db.raw
      .query<TopicRow, []>("SELECT * FROM topics ORDER BY name COLLATE NOCASE ASC")
      .all();
    return rows.map(toTopic);
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
      createdAt: Date.now(),
    };

    try {
      this.db.raw
        .query("INSERT INTO topics (id, name, description, created_at) VALUES (?, ?, ?, ?)")
        .run(topic.id, topic.name, topic.description ?? null, topic.createdAt);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE")) {
        throw new ValidationError(`A topic named "${topic.name}" already exists`);
      }
      throw error;
    }

    return topic;
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
    createdAt: row.created_at,
  };
}
