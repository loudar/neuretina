import { NotFoundError } from "../../core/errors.ts";
import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";

/**
 * Generic artifact: any text or binary output a workflow produces (briefs,
 * audio, notes, datasets, …), with references back to the run that made it
 * and, optionally, to a parent artifact it belongs to.
 */
export interface Artifact {
  id: string;
  kind: string;
  name?: string;
  contentType: string;
  /** Text payload (markdown, JSON, plain text) — always loaded. */
  content?: string;
  /** Binary payload — only loaded when requested. */
  data?: Uint8Array;
  metadata: Record<string, unknown>;
  /** Artifact this one belongs to (e.g. a brief's audio → its brief). */
  parentId?: string;
  /** Workflow that produced the artifact. */
  workflow?: string;
  /** Workflow run that produced the artifact. */
  correlationId?: string;
  createdAt: number;
  hasContent: boolean;
  hasData: boolean;
  byteSize?: number;
}

export interface CreateArtifactInput {
  kind: string;
  name?: string;
  contentType: string;
  content?: string;
  data?: Uint8Array;
  metadata?: Record<string, unknown>;
  parentId?: string;
  workflow?: string;
  correlationId?: string;
}

export interface ListArtifactsOptions {
  kind?: string;
  workflow?: string;
  parentId?: string;
  limit?: number;
}

interface ArtifactRow {
  id: string;
  kind: string;
  name: string | null;
  content_type: string;
  content: string | null;
  data?: Uint8Array | null;
  metadata: string;
  parent_id: string | null;
  workflow: string | null;
  correlation_id: string | null;
  created_at: number;
  has_content: number;
  has_data: number;
  byte_size: number | null;
}

const COLUMNS =
  "id, kind, name, content_type, content, metadata, parent_id, workflow, correlation_id, created_at, " +
  "(content IS NOT NULL) AS has_content, (data IS NOT NULL) AS has_data, length(data) AS byte_size";

/** Stores every workflow output in one table so the engine stays generic. */
export class ArtifactRepository {
  constructor(private readonly db: SqliteDatabase) {}

  create(input: CreateArtifactInput): Artifact {
    const id = crypto.randomUUID();
    const createdAt = Date.now();
    const metadata = input.metadata ?? {};

    this.db.raw
      .query(
        `INSERT INTO artifacts
           (id, kind, name, content_type, content, data, metadata, parent_id, workflow, correlation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.name ?? null,
        input.contentType,
        input.content ?? null,
        input.data ?? null,
        JSON.stringify(metadata),
        input.parentId ?? null,
        input.workflow ?? null,
        input.correlationId ?? null,
        createdAt,
      );

    return {
      id,
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      content: input.content,
      metadata,
      parentId: input.parentId,
      workflow: input.workflow,
      correlationId: input.correlationId,
      createdAt,
      hasContent: input.content !== undefined,
      hasData: input.data !== undefined,
      byteSize: input.data?.byteLength,
    };
  }

  get(id: string, options: { includeData?: boolean } = {}): Artifact {
    const columns = options.includeData ? `${COLUMNS}, data` : COLUMNS;
    const row = this.db.raw
      .query<ArtifactRow, [string]>(`SELECT ${columns} FROM artifacts WHERE id = ?`)
      .get(id);
    if (!row) throw new NotFoundError(`Artifact ${id} not found`);
    return toArtifact(row, options.includeData === true);
  }

  list(options: ListArtifactsOptions = {}): Artifact[] {
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (options.kind) {
      conditions.push("kind = ?");
      params.push(options.kind);
    }
    if (options.workflow) {
      conditions.push("workflow = ?");
      params.push(options.workflow);
    }
    if (options.parentId) {
      conditions.push("parent_id = ?");
      params.push(options.parentId);
    }

    const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 500);
    params.push(limit);
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = this.db.raw
      .query<ArtifactRow, Array<string | number>>(
        `SELECT ${COLUMNS} FROM artifacts ${where} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params);
    return rows.map((row) => toArtifact(row, false));
  }

  /** Text search over content, name and metadata (topics, …). */
  search(query: string | undefined, options: { kind?: string; limit?: number } = {}): Artifact[] {
    const trimmed = query?.trim();
    const limit = Math.min(Math.max(Math.floor(options.limit ?? 3), 1), 100);
    if (!trimmed) return this.list({ kind: options.kind, limit });

    const like = `%${trimmed}%`;
    const conditions = ["(content LIKE ? OR name LIKE ? OR metadata LIKE ?)"];
    const params: Array<string | number> = [like, like, like];
    if (options.kind) {
      conditions.push("kind = ?");
      params.push(options.kind);
    }
    params.push(limit);

    const rows = this.db.raw
      .query<ArtifactRow, Array<string | number>>(
        `SELECT ${COLUMNS} FROM artifacts WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...params);
    return rows.map((row) => toArtifact(row, false));
  }

  updateMetadata(id: string, patch: Record<string, unknown>): Artifact {
    const artifact = this.get(id);
    const metadata = { ...artifact.metadata, ...patch };
    this.db.raw.query("UPDATE artifacts SET metadata = ? WHERE id = ?").run(JSON.stringify(metadata), id);
    return { ...artifact, metadata };
  }

  /** Replaces the binary payload in place (regenerating a brief's audio). */
  replaceData(id: string, data: Uint8Array, contentType?: string): Artifact {
    const artifact = this.get(id);
    this.db.raw
      .query("UPDATE artifacts SET data = ?, content_type = COALESCE(?, content_type) WHERE id = ?")
      .run(data, contentType ?? null, id);
    return {
      ...artifact,
      contentType: contentType ?? artifact.contentType,
      hasData: true,
      byteSize: data.byteLength,
    };
  }

  /** Removes the artifact and everything referencing it as parent. */
  remove(id: string): Artifact {
    const artifact = this.get(id);
    this.db.transaction(() => {
      this.db.raw.query("DELETE FROM artifacts WHERE parent_id = ?").run(id);
      this.db.raw.query("DELETE FROM artifacts WHERE id = ?").run(id);
    });
    return artifact;
  }
}

function toArtifact(row: ArtifactRow, withData: boolean): Artifact {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name ?? undefined,
    contentType: row.content_type,
    content: row.content ?? undefined,
    ...(withData && row.data ? { data: row.data } : {}),
    metadata: parseMetadata(row.metadata),
    parentId: row.parent_id ?? undefined,
    workflow: row.workflow ?? undefined,
    correlationId: row.correlation_id ?? undefined,
    createdAt: row.created_at,
    hasContent: row.has_content === 1,
    hasData: row.has_data === 1,
    byteSize: row.byte_size ?? undefined,
  };
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to an empty metadata object
  }
  return {};
}
