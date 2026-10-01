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
  /** Timeline artifact composed of the brief's extracted events, when any. */
  timelineArtifactId?: string;
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

/** A brief fetched through its anonymous share token (no session needed). */
export interface SharedBrief {
  id: string;
  createdAt: number;
  topics: string[];
  markdown: string;
  narration: string;
  sources: BriefSource[];
  hasAudio: boolean;
  audioMime?: string;
  audioDurationMs?: number;
}

/** A dated event extracted from a brief; the rows behind timeline artifacts. */
export interface TimelineEvent {
  id: string;
  /** ISO calendar date (YYYY-MM-DD). */
  date: string;
  /** Time of day (HH:MM) when the source states one. */
  time?: string;
  entities: string[];
  tags: string[];
  title: string;
  description: string;
  /** Brief the event was extracted from, when known. */
  sourceBriefId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Portable configuration bundle (topics, workflows, channels, schedules, settings). */
export interface DataBundle {
  version: number;
  exportedAt: number;
  topics: Array<{
    id: string;
    name: string;
    description?: string;
    muted: boolean;
    contextId?: string;
  }>;
  userWorkflows: Array<{ id: string; name: string; inputs: Record<string, unknown> }>;
  deliveryChannels: Array<{
    id: string;
    type: string;
    name: string;
    config: Record<string, unknown>;
    enabled: boolean;
  }>;
  deliveryAttachments: Array<{
    workflow: string;
    step: string;
    output: string;
    channelId: string;
  }>;
  jobs: Array<{
    name: string;
    cron: string;
    timezone?: string;
    workflow: string;
    contextId?: string;
    input: Record<string, unknown>;
    enabled: boolean;
  }>;
  /** Stored user-specific settings and API keys; treat the bundle as secret. */
  settings: Array<{ key: string; value: string }>;
}

export interface DataImportSummary {
  topics: number;
  deliveryChannels: number;
  deliveryAttachments: number;
  userWorkflows: number;
  jobs: number;
  settings: number;
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

/** A configurable workflow input (topics today; more kinds later). */
export interface WorkflowInputInfo {
  /** Key the configured value is stored under, e.g. "topics". */
  id: string;
  /** Value kind; drives the editor control. */
  kind: string;
  title: string;
  description?: string;
  required: boolean;
  multiple: boolean;
}

/** A value a workflow step consumes. */
export interface WorkflowStepInputInfo {
  kind: string;
  title: string;
  description?: string;
  /** Optional inputs may be missing for a run. */
  required: boolean;
}

/** A value a workflow step produces. */
export interface WorkflowStepOutputInfo {
  kind: string;
  title: string;
  description?: string;
  /** Guaranteed outputs always exist after the step; optional ones may not. */
  guaranteed: boolean;
  /** Deliverable outputs can be assigned delivery channels. */
  deliverable: boolean;
}

/** One action the workflow takes. */
export interface WorkflowStepInfo {
  id: string;
  type: string;
  title: string;
  description?: string;
  inputs: WorkflowStepInputInfo[];
  outputs: WorkflowStepOutputInfo[];
}

export interface WorkflowInfo {
  id: string;
  title: string;
  description: string;
  contextId?: string;
  triggers: string[];
  inputs: WorkflowInputInfo[];
  steps: WorkflowStepInfo[];
  /** Set for user-created workflow instances. */
  user?: boolean;
  /** Configured input values (undefined = the workflow's defaults). */
  inputValues?: Record<string, unknown>;
}

export interface UserWorkflowInfo {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
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
  /** Effective value (secrets included) so the eye toggle can reveal it. */
  value: string | null;
  configured: boolean;
  stored: boolean;
}

export type DeliveryChannelType = "matrix" | "discord" | "email";

export interface DeliveryChannelInfo {
  id: string;
  type: DeliveryChannelType;
  name: string;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface DeliveryWorkflowInfo {
  workflow: string;
  channelIds: string[];
}

/** A channel assignment: which step output a channel receives. */
export interface DeliveryAttachmentInfo {
  workflow: string;
  step: string;
  output: string;
  channelId: string;
}

/** Identifies one deliverable step output. */
export interface DeliveryTargetInfo {
  workflow: string;
  step: string;
  output: string;
}

export interface DeliveryRecord {
  id: string;
  briefId: string;
  runId?: string;
  channelId: string;
  kind: "text" | "voice";
  status: "pending" | "sent" | "failed";
  eventId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Fetches a shared brief without a session; the token is the credential. */
export async function fetchSharedBrief(token: string): Promise<SharedBrief> {
  const response = await fetch(`/api/share/brief/${encodeURIComponent(token)}`);
  const body = (await response.json().catch(() => ({}))) as {
    brief?: SharedBrief;
    error?: string;
  };
  if (!response.ok || !body.brief) {
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return body.brief;
}
