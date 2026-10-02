import { connection } from "./connection.svelte";
import type {
  AppConfigInfo,
  AppContextInfo,
  ArtifactInfo,
  Report,
  ReportAudio,
  DataBundle,
  DataImportSummary,
  DecisionProviderId,
  DeliveryAttachmentInfo,
  DeliveryChannelInfo,
  DeliveryChannelType,
  DeliveryRecord,
  DeliveryTargetInfo,
  DeliveryWorkflowInfo,
  FinanceProviderId,
  LlmProviderId,
  ScheduledJob,
  SearchProviderId,
  SettingInfo,
  TimelineEvent,
  Topic,
  UserWorkflowInfo,
  WorkflowInfo,
  WorkflowRunDetail,
  WorkflowRunInfo,
} from "./api";

/**
 * Sends a message over the WebSocket connection and resolves with the handler
 * result. Every backend interaction from the UI uses this; no HTTP endpoints.
 */
export async function send<T = unknown>(
  type: string,
  payload?: unknown,
  timeoutMs = 60_000,
): Promise<T> {
  return connection.request<T>(type, payload, timeoutMs);
}

export const commands = {
  config: () => send<AppConfigInfo>("config.get"),

  settings: {
    list: () => send<SettingInfo[]>("settings.list"),
    set: (key: string, value: string) => send<SettingInfo>("settings.set", { key, value }),
    clear: (key: string) => send<SettingInfo>("settings.clear", { key }),
  },

  llm: {
    /** Live pre-flight: stored connection by id, or unsaved dialog values. */
    verify: (connection: {
      id?: string;
      provider?: LlmProviderId;
      model?: string;
      baseUrl?: string;
      apiKey?: string;
    }) => send<{ ok: boolean; detail: string }>("llm.provider.verify", connection),
  },

  decision: {
    /** Live pre-flight: stored connection by id, or unsaved dialog values. */
    verify: (connection: {
      id?: string;
      provider?: DecisionProviderId;
      model?: string;
      baseUrl?: string;
      accountId?: string;
      apiKey?: string;
    }) => send<{ ok: boolean; detail: string }>("decision.model.verify", connection),
  },

  search: {
    /** Live pre-flight: stored connection by id, or unsaved dialog values. */
    verify: (connection: {
      id?: string;
      provider?: SearchProviderId;
      baseUrl?: string;
      apiKey?: string;
    }) => send<{ ok: boolean; detail: string }>("search.provider.verify", connection),
  },

  finance: {
    /** Live pre-flight: stored connection by id, or unsaved dialog values. */
    verify: (connection: {
      id?: string;
      provider?: FinanceProviderId;
      baseUrl?: string;
      model?: string;
      apiKey?: string;
    }) => send<{ ok: boolean; detail: string }>("finance.provider.verify", connection),
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

  reports: {
    list: () => send<Report[]>("report.list"),
    get: (id: string) => send<Report>("report.get", { id }),
    audio: (id: string) => send<ReportAudio | null>("report.audio", { id }),
    remove: (id: string) => send<{ ok: boolean; reportId: string }>("report.delete", { id }),
    generateAudio: (id: string, options: { regenerate?: boolean; deliver?: boolean } = {}) =>
      send<{
        reportId: string;
        generated: boolean;
        bytes: number;
        durationMs: number | null;
        eventId: string | null;
      }>("report.audio.generate", { id, ...options }),
    send: (id: string, channels: string[]) => send<{ reportId: string; results: Array<{ channelId: string; status: string; eventId?: string; error?: string }> }>("report.send", {
      id,
      channels,
    }),
  },

  userWorkflows: {
    list: () => send<UserWorkflowInfo[]>("workflow.user.list"),
    create: (input: { name: string; inputs: Record<string, unknown>; stopAfter?: string }) =>
      send<UserWorkflowInfo>("workflow.user.create", input),
    update: (
      id: string,
      patch: { name?: string; inputs?: Record<string, unknown>; stopAfter?: string | null },
    ) => send<UserWorkflowInfo>("workflow.user.update", { id, ...patch }),
    remove: (id: string) => send<{ ok: boolean }>("workflow.user.remove", { id }),
  },

  delivery: {
    channels: () => send<DeliveryChannelInfo[]>("delivery.channel.list"),
    createChannel: (input: { type: DeliveryChannelType; name: string; config?: Record<string, unknown> }) =>
      send<DeliveryChannelInfo>("delivery.channel.create", input),
    updateChannel: (
      id: string,
      patch: { name?: string; config?: Record<string, unknown>; enabled?: boolean },
    ) => send<DeliveryChannelInfo>("delivery.channel.update", { id, ...patch }),
    removeChannel: (id: string) => send<{ ok: boolean }>("delivery.channel.delete", { id }),
    verifyChannel: (id: string) =>
      send<{ ok: boolean; detail: string }>("delivery.channel.verify", { id }),
    workflows: () => send<DeliveryWorkflowInfo[]>("delivery.workflows"),
    attachments: () => send<DeliveryAttachmentInfo[]>("delivery.attachments"),
    attach: (target: DeliveryTargetInfo, channelId: string) =>
      send<{ ok: boolean }>("delivery.attach", { ...target, channelId }),
    detach: (target: DeliveryTargetInfo, channelId: string) =>
      send<{ ok: boolean }>("delivery.detach", { ...target, channelId }),
    list: (filter: { reportId?: string; runId?: string } = {}) =>
      send<DeliveryRecord[]>("delivery.list", filter),
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

  timeline: {
    /** Dated events by id (the ones a timeline artifact references). */
    events: (ids?: string[]) => send<TimelineEvent[]>("timeline.event.list", { ids }),
  },

  data: {
    /** Snapshot of the hand-configured parts of this account. */
    export: () => send<DataBundle>("data.export"),
    /** Merges a bundle into this account; returns what was imported. */
    import: (bundle: DataBundle) => send<DataImportSummary>("data.import", { bundle }),
  },
};
