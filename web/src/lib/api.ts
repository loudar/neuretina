export interface Topic {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
}

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
  hasAudio: boolean;
  audioMime?: string;
  audioDurationMs?: number;
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
    elevenlabs: boolean;
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
  elevenlabs: { modelId: string; voiceId: string; outputFormat: string };
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
    update: (id: string, patch: Partial<Pick<ScheduledJob, "name" | "cron" | "enabled">>) =>
      send<ScheduledJob>("job.update", { id, ...patch }),
    remove: (id: string) => send<{ ok: boolean }>("job.delete", { id }),
    run: (id: string) => send<{ started: boolean }>("job.run", { id }),
  },

  briefs: {
    list: () => send<Brief[]>("brief.list"),
    get: (id: string) => send<Brief>("brief.get", { id }),
    audio: (id: string) => send<BriefAudio | null>("brief.audio", { id }),
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
};

