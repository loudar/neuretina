import type { SearchMedia } from "../../capabilities/search/SearchProvider.ts";
import { NotFoundError } from "../../core/errors.ts";
import type { Artifact, ArtifactStore } from "../artifacts/ArtifactRepository.ts";

export interface BriefSource {
  title: string;
  url: string;
  provider: string;
  /** Short excerpt, e.g. the text of a social post. */
  snippet?: string;
  /** Attached media (Bluesky images / video thumbnails). */
  media?: SearchMedia[];
}

/**
 * A brief as stored: a typed view over the generic artifacts table. The
 * brief itself is a `brief` artifact (markdown content, topics/narration/
 * sources in metadata); its audio is a separate `audio` artifact referencing
 * the brief as parent and referenced back through `audioArtifactId`.
 */
export interface Brief {
  id: string;
  /** Id of the underlying artifact (the brief's canonical reference). */
  artifactId: string;
  createdAt: number;
  correlationId?: string;
  workflow?: string;
  /** Context this brief belongs to. */
  contextId: string;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
  audioArtifactId?: string;
  audioMime?: string;
  audioDurationMs?: number;
  hasAudio: boolean;
}

export interface BriefWithAudio extends Brief {
  audio?: Uint8Array;
}

export interface CreateBriefInput {
  correlationId?: string;
  workflow?: string;
  contextId?: string;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
}

const BRIEF_KIND = "brief";
const AUDIO_KIND = "audio";
const MARKDOWN_TYPE = "text/markdown";

/** Storage-agnostic brief store; swap the implementation without touching consumers. */
export interface BriefStore {
  create(input: CreateBriefInput): Brief;
  /**
   * Stores the brief's speech as a generic audio artifact referencing the
   * brief, and points the brief back at it. Returns the audio artifact id.
   */
  attachAudio(id: string, audio: Uint8Array, mimeType: string, durationMs?: number): string;
  get(id: string, includeAudio?: boolean): BriefWithAudio;
  getAudio(id: string): { audio: Uint8Array; mimeType: string } | null;
  list(limit?: number, contextId?: string): Brief[];
  /** Searches earlier briefs (markdown + topics); without a query returns the latest. */
  search(query: string | undefined, limit?: number, contextId?: string): Brief[];
  latest(contextId?: string): Brief | null;
  remove(id: string): Brief;
}

export class BriefRepository implements BriefStore {
  constructor(private readonly artifacts: ArtifactStore) {}

  create(input: CreateBriefInput): Brief {
    const artifact = this.artifacts.create({
      kind: BRIEF_KIND,
      name: input.topics.join(", ") || undefined,
      contentType: MARKDOWN_TYPE,
      content: input.markdown,
      metadata: {
        topics: input.topics,
        narration: input.narration,
        sources: input.sources,
      },
      workflow: input.workflow,
      correlationId: input.correlationId,
      contextId: input.contextId,
    });
    return toBrief(artifact);
  }

  /**
   * Stores the brief's speech as a generic audio artifact referencing the
   * brief, and points the brief back at it. Returns the audio artifact id.
   */
  attachAudio(id: string, audio: Uint8Array, mimeType: string, durationMs?: number): string {
    const brief = this.loadBriefArtifact(id);
    const existing = stringField(brief.metadata, "audioArtifactId");
    const audioDuration = durationMs !== undefined ? { durationMs } : {};
    const briefDuration = durationMs !== undefined ? { audioDurationMs: durationMs } : {};

    if (existing) {
      this.artifacts.replaceData(existing, audio, mimeType);
      this.artifacts.updateMetadata(existing, { briefId: id, mime: mimeType, ...audioDuration });
      this.artifacts.updateMetadata(id, { audioMime: mimeType, ...briefDuration });
      return existing;
    }

    const created = this.artifacts.create({
      kind: AUDIO_KIND,
      name: brief.name ? `${brief.name} (audio)` : "brief audio",
      contentType: mimeType,
      data: audio,
      parentId: id,
      workflow: brief.workflow,
      correlationId: brief.correlationId,
      contextId: brief.contextId,
      metadata: { briefId: id, ...audioDuration },
    });
    this.artifacts.updateMetadata(id, {
      audioArtifactId: created.id,
      audioMime: mimeType,
      ...briefDuration,
    });
    return created.id;
  }

  get(id: string, includeAudio = false): BriefWithAudio {
    const brief: BriefWithAudio = toBrief(this.loadBriefArtifact(id));
    if (includeAudio && brief.audioArtifactId) {
      const audio = this.artifacts.get(brief.audioArtifactId, { includeData: true });
      if (audio.data) brief.audio = audio.data;
    }
    return brief;
  }

  getAudio(id: string): { audio: Uint8Array; mimeType: string } | null {
    let artifact: Artifact;
    try {
      artifact = this.artifacts.get(id);
    } catch {
      return null;
    }
    if (artifact.kind !== BRIEF_KIND) return null;

    const audioArtifactId = stringField(artifact.metadata, "audioArtifactId");
    if (!audioArtifactId) return null;

    const audio = this.artifacts.get(audioArtifactId, { includeData: true });
    if (!audio.data) return null;
    return { audio: audio.data, mimeType: audio.contentType };
  }

  list(limit = 50, contextId?: string): Brief[] {
    return this.artifacts.list({ kind: BRIEF_KIND, contextId, limit }).map(toBrief);
  }

  /** Searches earlier briefs (markdown + topics); without a query returns the latest. */
  search(query: string | undefined, limit = 3, contextId?: string): Brief[] {
    return this.artifacts.search(query, { kind: BRIEF_KIND, contextId, limit }).map(toBrief);
  }

  latest(contextId?: string): Brief | null {
    return this.list(1, contextId)[0] ?? null;
  }

  remove(id: string): Brief {
    const brief = toBrief(this.loadBriefArtifact(id));
    this.artifacts.remove(id);
    return brief;
  }

  private loadBriefArtifact(id: string): Artifact {
    const artifact = this.artifacts.get(id);
    if (artifact.kind !== BRIEF_KIND) throw new NotFoundError(`Brief ${id} not found`);
    return artifact;
  }
}

function toBrief(artifact: Artifact): Brief {
  const audioArtifactId = stringField(artifact.metadata, "audioArtifactId");
  return {
    id: artifact.id,
    artifactId: artifact.id,
    createdAt: artifact.createdAt,
    correlationId: artifact.correlationId,
    workflow: artifact.workflow,
    contextId: artifact.contextId,
    topics: stringArray(artifact.metadata.topics),
    markdown: artifact.content ?? "",
    narration: stringField(artifact.metadata, "narration") ?? "",
    sources: Array.isArray(artifact.metadata.sources)
      ? (artifact.metadata.sources as BriefSource[])
      : [],
    audioArtifactId,
    audioMime: stringField(artifact.metadata, "audioMime"),
    audioDurationMs: numberField(artifact.metadata, "audioDurationMs"),
    hasAudio: Boolean(audioArtifactId),
  };
}

function stringField(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === "string" && value ? value : undefined;
}

function numberField(metadata: Record<string, unknown>, key: string): number | undefined {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
