import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import { NotFoundError } from "../../core/errors.ts";

export interface BriefSource {
  title: string;
  url: string;
  provider: string;
}

export interface Brief {
  id: string;
  createdAt: number;
  correlationId?: string;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
  audioMime?: string;
  audioDurationMs?: number;
  hasAudio: boolean;
}

export interface BriefWithAudio extends Brief {
  audio?: Uint8Array;
}

export interface CreateBriefInput {
  correlationId?: string;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
}

interface BriefRow {
  id: string;
  created_at: number;
  correlation_id: string | null;
  topics: string;
  markdown: string;
  narration: string;
  sources: string;
  has_audio: number;
  audio?: Uint8Array | null;
  audio_mime: string | null;
  audio_duration_ms: number | null;
}

/** Omits the (potentially large) audio blob; has_audio is computed by SQL. */
const LIST_COLUMNS =
  "id, created_at, correlation_id, topics, markdown, narration, sources, audio_mime, audio_duration_ms, (audio IS NOT NULL) AS has_audio";

export class BriefRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateBriefInput): Brief {
    const id = crypto.randomUUID();
    const createdAt = Date.now();

    this.db.raw
      .query(
        `INSERT INTO briefs (id, created_at, correlation_id, topics, markdown, narration, sources)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        createdAt,
        input.correlationId ?? null,
        JSON.stringify(input.topics),
        input.markdown,
        input.narration,
        JSON.stringify(input.sources),
      );

    return {
      id,
      createdAt,
      correlationId: input.correlationId,
      topics: input.topics,
      markdown: input.markdown,
      narration: input.narration,
      sources: input.sources,
      hasAudio: false,
    };
  }

  attachAudio(id: string, audio: Uint8Array, mimeType: string, durationMs?: number): void {
    const result = this.db.raw
      .query("UPDATE briefs SET audio = ?, audio_mime = ?, audio_duration_ms = ? WHERE id = ?")
      .run(audio, mimeType, durationMs ?? null, id);
    if (result.changes === 0) throw new NotFoundError(`Brief ${id} not found`);
  }

  remove(id: string): Brief {
    const brief = this.get(id);
    this.db.raw.query("DELETE FROM briefs WHERE id = ?").run(id);
    return brief;
  }

  get(id: string, includeAudio = false): BriefWithAudio {
    const row = this.db.raw
      .query<BriefRow, [string]>(
        includeAudio
          ? "SELECT *, (audio IS NOT NULL) AS has_audio FROM briefs WHERE id = ?"
          : `SELECT ${LIST_COLUMNS} FROM briefs WHERE id = ?`,
      )
      .get(id);
    if (!row) throw new NotFoundError(`Brief ${id} not found`);
    return toBrief(row, includeAudio);
  }

  getAudio(id: string): { audio: Uint8Array; mimeType: string } | null {
    const row = this.db.raw
      .query<Pick<BriefRow, "audio" | "audio_mime">, [string]>(
        "SELECT audio, audio_mime FROM briefs WHERE id = ?",
      )
      .get(id);
    if (!row?.audio) return null;
    return { audio: row.audio, mimeType: row.audio_mime ?? "application/octet-stream" };
  }

  list(limit = 50): Brief[] {
    const rows = this.db.raw
      .query<BriefRow, [number]>(
        `SELECT ${LIST_COLUMNS} FROM briefs ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit);
    return rows.map((row) => toBrief(row, false));
  }

  /** Searches earlier briefs (markdown + topics); without a query returns the latest. */
  search(query: string | undefined, limit = 3): Brief[] {
    const trimmed = query?.trim();
    if (!trimmed) return this.list(limit);

    const like = `%${trimmed}%`;
    const rows = this.db.raw
      .query<BriefRow, [string, string, number]>(
        `SELECT ${LIST_COLUMNS} FROM briefs WHERE markdown LIKE ? OR topics LIKE ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(like, like, limit);
    return rows.map((row) => toBrief(row, false));
  }

  latest(): Brief | null {
    const row = this.db.raw
      .query<BriefRow, []>(`SELECT ${LIST_COLUMNS} FROM briefs ORDER BY created_at DESC LIMIT 1`)
      .get();
    return row ? toBrief(row, false) : null;
  }
}

function toBrief(row: BriefRow, includeAudio: boolean): BriefWithAudio {
  const brief: BriefWithAudio = {
    id: row.id,
    createdAt: row.created_at,
    correlationId: row.correlation_id ?? undefined,
    topics: JSON.parse(row.topics) as string[],
    markdown: row.markdown,
    narration: row.narration,
    sources: JSON.parse(row.sources) as BriefSource[],
    audioMime: row.audio_mime ?? undefined,
    audioDurationMs: row.audio_duration_ms ?? undefined,
    hasAudio: row.has_audio === 1 || Boolean(row.audio),
  };
  if (includeAudio && row.audio) brief.audio = row.audio;
  return brief;
}
