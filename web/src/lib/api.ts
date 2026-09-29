export interface Topic {
  id: string;
  name: string;
  description?: string;
  muted: boolean;
  createdAt: number;
}

export interface BriefSourceMedia {
  type: "image" | "video";
  thumbUrl: string;
  fullUrl: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface BriefSource {
  title: string;
  url: string;
  provider: string;
  /** Short excerpt, e.g. the text of a social post. */
  snippet?: string;
  /** Attached media (Bluesky images / video thumbnails). */
  media?: BriefSourceMedia[];
}

export interface Brief {
  id: string;
  /** Id of the underlying generic artifact. */
  artifactId: string;
  createdAt: number;
  correlationId?: string;
  workflow?: string;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
  audioArtifactId?: string;
  hasAudio: boolean;
  audioMime?: string;
  audioDurationMs?: number;
}

export interface ArtifactInfo {
  id: string;
  kind: string;
  name?: string;
  contentType: string;
  content?: string;
  metadata: Record<string, unknown>;
  parentId?: string;
  workflow?: string;
  correlationId?: string;
  createdAt: number;
  hasContent: boolean;
  hasData: boolean;
  byteSize?: number;
}

export interface BriefAudio {
  dataUrl: string;
  mimeType: string;
  durationMs: number | null;
}

export interface ScheduledJob {
  id: string;
  name: string;
  cron: string;
  timezone?: string;
  workflow: string;
  input: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastStatus?: "success" | "failed";
}

export interface WorkflowInfo {
  id: string;
  description: string;
}

export interface DomainEvent<T = unknown> {
  seq: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  correlationId?: string;
  payload: T;
}

export type BlueskyMode = "authenticated" | "public";

export interface AppConfigInfo {
  integrations: {
    llm: boolean;
    perplexity: boolean;
    tts: boolean;
    bluesky: BlueskyMode;
    matrix: boolean;
  };
  defaults: {
    briefCron: string;
    searchRecency: string;
    searchResultsPerProvider: number;
    briefLanguage: string;
  };
  timezone: string;
  llm: { model: string; baseUrl: string };
  tts: { provider: string; baseUrl: string; model: string; voiceId: string; outputFormat: string };
  matrix: { roomId?: string };
}

/**
 * Sends a message through the webhook gateway and returns the handler result
 * from the same HTTP response. Every interaction with the backend uses this.
 */
export async function send<T = unknown>(
  type: string,
  payload?: unknown,
  timeoutMs = 60_000,
): Promise<T> {
  const response = await fetch("/api/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, payload }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  let body: { ok?: boolean; result?: unknown; error?: string } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // keep empty body
  }

  if (!response.ok) {
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }

  return body.result as T;
}

export const commands = {
  config: () => send<AppConfigInfo>("config.get"),

  topics: {
    list: () => send<Topic[]>("topic.list"),
    create: (input: { name: string; description?: string }) => send<Topic>("topic.create", input),
    update: (id: string, patch: { name?: string; description?: string; muted?: boolean }) =>
      send<Topic>("topic.update", { id, ...patch }),
    remove: (id: string) => send<{ ok: boolean }>("topic.delete", { id }),
  },

  jobs: {
    list: () => send<ScheduledJob[]>("job.list"),
    create: (input: {
      name: string;
      cron: string;
      timezone?: string;
      workflow: string;
      input?: Record<string, unknown>;
      enabled?: boolean;
    }) => send<ScheduledJob>("job.create", input),
    update: (
      id: string,
      patch: Partial<Pick<ScheduledJob, "name" | "cron" | "enabled" | "input">>,
    ) => send<ScheduledJob>("job.update", { id, ...patch }),
    remove: (id: string) => send<{ ok: boolean }>("job.delete", { id }),
    run: (id: string) => send<{ started: boolean }>("job.run", { id }),
  },

  briefs: {
    list: () => send<Brief[]>("brief.list"),
    get: (id: string) => send<Brief>("brief.get", { id }),
    audio: (id: string) => send<BriefAudio | null>("brief.audio", { id }),
    remove: (id: string) => send<{ ok: boolean; briefId: string }>("brief.delete", { id }),
    generateAudio: (id: string, options: { regenerate?: boolean; deliver?: boolean } = {}) =>
      send<{
        briefId: string;
        generated: boolean;
        bytes: number;
        durationMs: number | null;
        eventId: string | null;
      }>("brief.audio.generate", { id, ...options }),
    send: (id: string) =>
      send<{ briefId: string; sent: Array<{ kind: string; eventId: string }> }>("brief.send", {
        id,
      }),
  },

  workflows: {
    list: () => send<WorkflowInfo[]>("workflow.list"),
    run: (id: string, input: Record<string, unknown> = {}) =>
      send<{ started: boolean }>("workflow.run", { id, input }),
  },

  artifacts: {
    list: (options: { kind?: string; workflow?: string; parentId?: string; limit?: number } = {}) =>
      send<ArtifactInfo[]>("artifact.list", options),
    get: (id: string) => send<ArtifactInfo>("artifact.get", { id }),
    content: (id: string) =>
      send<{ id: string; kind: string; contentType: string; content: string | null }>(
        "artifact.content",
        { id },
      ),
    data: (id: string) =>
      send<{
        id: string;
        kind: string;
        contentType: string;
        byteSize: number;
        dataUrl: string;
      } | null>("artifact.data", { id }),
    remove: (id: string) =>
      send<{ ok: boolean; artifactId: string; kind: string }>("artifact.delete", { id }),
  },
};

