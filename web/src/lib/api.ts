export interface Topic {
  id: string;
  name: string;
  description?: string;
  muted: boolean;
  contextId?: string;
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
  contextId?: string;
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
  contextId?: string;
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
  contextId?: string;
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
  contextId?: string;
  triggers: string[];
}

export interface AppContextInfo {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  topics: number;
  jobs: number;
  runs: number;
  artifacts: number;
}

export type WorkflowRunStatus = "running" | "succeeded" | "failed" | "skipped" | "cancelled";

export interface CostLine {
  /** Workflow step the cost belongs to, e.g. "Research". */
  step: string;
  /** Provider that billed it, e.g. "llm" or "perplexity". */
  provider: string;
  /** Human-readable usage, e.g. "2 calls · 12,340 in / 567 out tokens". */
  detail: string;
  /** USD; unpriced usage is reported as 0. */
  usd: number;
}

export interface CostReport {
  totalUsd: number;
  /** False when at least one line has no known price. */
  complete: boolean;
  lines: CostLine[];
}

export interface WorkflowRunInfo {
  id: string;
  workflow: string;
  contextId: string;
  trigger: string;
  triggerDetail: Record<string, unknown>;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  cost?: CostReport;
}

export type WorkflowRunDetail = WorkflowRunInfo & { artifacts: ArtifactInfo[] };

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

export type SettingKind = "string" | "secret" | "number" | "boolean" | "list" | "enum";
export type SettingSource = "env" | "db" | "default";

export interface SettingInfo {
  key: string;
  group: string;
  label: string;
  description?: string;
  kind: SettingKind;
  options?: string[];
  defaultValue?: string;
  /** `env` values always win over database overrides. */
  source: SettingSource;
  /** Effective value; `null` for secrets, which the backend never sends. */
  value: string | null;
  configured: boolean;
  stored: boolean;
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

  settings: {
    list: () => send<SettingInfo[]>("settings.list"),
    set: (key: string, value: string) => send<SettingInfo>("settings.set", { key, value }),
    clear: (key: string) => send<SettingInfo>("settings.clear", { key }),
  },

  contexts: {
    list: () => send<AppContextInfo[]>("context.list"),
  },

  topics: {
    list: (contextId?: string) => send<Topic[]>("topic.list", { contextId }),
    create: (input: { name: string; description?: string; contextId?: string }) =>
      send<Topic>("topic.create", input),
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
      contextId?: string;
      input?: Record<string, unknown>;
      enabled?: boolean;
    }) => send<ScheduledJob>("job.create", input),
    update: (
      id: string,
      patch: Partial<Pick<ScheduledJob, "name" | "cron" | "enabled" | "input">>,
    ) => send<ScheduledJob>("job.update", { id, ...patch }),
    remove: (id: string) => send<{ ok: boolean }>("job.delete", { id }),
    run: (id: string) =>
      send<{ started: boolean; jobId: string; workflow: string; runId: string }>("job.run", { id }),
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
    run: (id: string, input: Record<string, unknown> = {}, contextId?: string) =>
      send<{ started: boolean; workflow: string; runId: string }>("workflow.run", {
        id,
        input,
        contextId,
      }),
    runs: (options: { contextId?: string; workflow?: string; limit?: number } = {}) =>
      send<WorkflowRunInfo[]>("workflow.run.list", options),
    runGet: (id: string) => send<WorkflowRunDetail>("workflow.run.get", { id }),
    removeRun: (id: string, artifacts: boolean) =>
      send<{ ok: boolean; runId: string; artifacts: number }>("workflow.run.delete", {
        id,
        artifacts,
      }),
    cancel: (id: string) =>
      send<{ ok: boolean; runId: string; cancelling: boolean }>("workflow.run.cancel", { id }),
  },

  artifacts: {
    list: (options: { kind?: string; workflow?: string; parentId?: string; limit?: number } = {}) =>
      send<ArtifactInfo[]>("artifact.list", options),
    search: (query?: string, options: { kind?: string; limit?: number } = {}) =>
      send<ArtifactInfo[]>("artifact.search", { query, ...options }),
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

