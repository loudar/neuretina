// Connection types, presets and labels come from the capability modules the
// server uses, so the UI and the engine cannot drift apart.
import {
  DECISION_PROVIDER_PRESETS,
  DECISION_PROVIDER_IDS,
  decisionModelLabel,
  type DecisionModelConnection,
  type DecisionProviderId,
  type DecisionProviderPreset,
} from "../../../src/capabilities/decision/DecisionProviders.ts";
import {
  FINANCE_PROVIDER_PRESETS,
  type FinanceConnection,
  type FinanceProviderId,
  type FinanceProviderPreset,
} from "../../../src/capabilities/finance/FinanceProviders.ts";
import {
  LLM_PROVIDER_PRESETS,
  LLM_PROVIDER_IDS,
  llmProviderLabel,
  type LlmConnection,
  type LlmProviderId,
  type LlmProviderPreset,
} from "../../../src/capabilities/llm/LlmProviders.ts";
import {
  SEARCH_PROVIDER_PRESETS,
  type SearchConnection,
  type SearchProviderId,
  type SearchProviderPreset,
} from "../../../src/capabilities/search/SearchProviders.ts";
import type { SearchMedia } from "../../../src/capabilities/search/SearchProvider.ts";
import type { SettingInfo, SettingKind, SettingSource } from "../../../src/config/settings.ts";
import type { CostLine, CostReport } from "../../../src/core/cost/CostTracker.ts";
import type { DomainEvent } from "../../../src/core/events/types.ts";
import type {
  StepInputSpec,
  StepOutputInfo,
  WorkflowInfo as WorkflowDefinitionInfo,
  WorkflowInputSpec,
  WorkflowStepInfo,
} from "../../../src/core/workflow/definition.ts";
import type { Artifact } from "../../../src/domain/artifacts/ArtifactRepository.ts";
import type {
  DeliveryAttachment,
  DeliveryChannel,
  DeliveryChannelType,
  DeliveryRecord,
  DeliveryTarget,
  DeliveryWorkflow,
} from "../../../src/domain/delivery/DeliveryRepository.ts";
import type { WorkflowRunStatus } from "../../../src/domain/runs/WorkflowRunRepository.ts";
import type { Topic } from "../../../src/domain/topics/TopicRepository.ts";
import type { TimelineEvent } from "../../../src/domain/events/EventRepository.ts";
import type { ScheduledJob } from "../../../src/domain/jobs/JobRepository.ts";
import type { ReportSource } from "../../../src/domain/reports/ReportRepository.ts";

// These shapes are the server's; re-exporting them keeps the UI in lockstep.
export type {
  CostLine,
  CostReport,
  DeliveryAttachment as DeliveryAttachmentInfo,
  DeliveryChannel as DeliveryChannelInfo,
  DeliveryChannelType,
  DeliveryRecord,
  DeliveryTarget as DeliveryTargetInfo,
  DeliveryWorkflow as DeliveryWorkflowInfo,
  ReportSource,
  ScheduledJob,
  SearchMedia as ReportSourceMedia,
  TimelineEvent,
  Topic,
  WorkflowRunStatus,
};

/** The artifact fields the UI receives; binary payloads never leave the API. */
export type ArtifactInfo = Omit<Artifact, "data">;

export interface Report {
  id: string;
  /** Id of the underlying generic artifact. */
  artifactId: string;
  createdAt: number;
  correlationId?: string;
  contextId?: string;
  workflow?: string;
  topics: string[];
  /** Attached artifacts in display order (timeline, audio, text, …). */
  artifacts: ArtifactInfo[];
  markdown: string;
  narration: string;
  sources: ReportSource[];
  audioArtifactId?: string;
  hasAudio: boolean;
  audioMime?: string;
  audioDurationMs?: number;
}

export interface ReportAudio {
  dataUrl: string;
  mimeType: string;
  durationMs: number | null;
}

/** The timeline artifact of a shared report, with the events it renders. */
export interface SharedTimeline {
  artifact: ArtifactInfo;
  events: TimelineEvent[];
}

/** A report fetched through its anonymous share token (no session needed). */
export interface SharedReport {
  id: string;
  createdAt: number;
  topics: string[];
  markdown: string;
  narration: string;
  sources: ReportSource[];
  hasAudio: boolean;
  audioMime?: string;
  audioDurationMs?: number;
  timeline?: SharedTimeline;
}

// The data-transfer types are the server's, so exports and imports cannot
// disagree about the bundle shape.
export type {
  DataBundle,
  ImportSummary as DataImportSummary,
} from "../../../src/commands/dataTransfer.ts";

// Workflow shapes are the definition module's; the web only adds the fields
// the list command decorates them with.
export type {
  StepInputSpec as WorkflowStepInputInfo,
  StepOutputInfo as WorkflowStepOutputInfo,
  WorkflowInputSpec as WorkflowInputInfo,
  WorkflowStepInfo,
};

export type WorkflowInfo = WorkflowDefinitionInfo & {
  /** Set for user-created workflow instances. */
  user?: boolean;
  /** Configured input values (undefined = the workflow's defaults). */
  inputValues?: Record<string, unknown>;
  /** Step id the run stops after; later steps never start. */
  stopAfter?: string;
};

export interface UserWorkflowInfo {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  /** Step id the run stops after; later steps never start. */
  stopAfter?: string;
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

export type { DomainEvent };

export type BlueskyMode = "authenticated" | "public";

export interface AppConfigInfo {
  integrations: {
    llm: boolean;
    search: boolean;
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
  llm: { provider: string; model: string; baseUrl: string };
  tts: { provider: string; baseUrl: string; model: string; voiceId: string; outputFormat: string };
  matrix: { roomId?: string };
}

export type { SettingInfo, SettingKind, SettingSource };

export {
  DECISION_PROVIDER_PRESETS,
  DECISION_PROVIDER_IDS,
  decisionModelLabel,
  LLM_PROVIDER_PRESETS,
  LLM_PROVIDER_IDS,
  llmProviderLabel,
  SEARCH_PROVIDER_PRESETS,
  FINANCE_PROVIDER_PRESETS,
};
export type {
  DecisionModelConnection,
  DecisionProviderId,
  DecisionProviderPreset,
  FinanceConnection,
  FinanceProviderId,
  FinanceProviderPreset,
  LlmConnection,
  LlmProviderId,
  LlmProviderPreset,
  SearchConnection,
  SearchProviderId,
  SearchProviderPreset,
};

/** Any provider's preset; the settings form reads only the shared fields. */
export type ConnectionPreset =
  | LlmProviderPreset
  | DecisionProviderPreset
  | SearchProviderPreset
  | FinanceProviderPreset;

export const SEARCH_PROVIDER_IDS = Object.keys(SEARCH_PROVIDER_PRESETS) as SearchProviderId[];
export const FINANCE_PROVIDER_IDS = Object.keys(FINANCE_PROVIDER_PRESETS) as FinanceProviderId[];

/** Parses a stored connection-list setting; rows missing required fields are dropped. */
function parseConnections<T>(value: string | null | undefined, fields: Array<keyof T & string>): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is T =>
        Boolean(entry) &&
        typeof entry === "object" &&
        fields.every((field) => typeof (entry as Record<string, unknown>)[field] === "string"),
    );
  } catch {
    return [];
  }
}

/** Parses the stored DECISION_MODELS value into connection rows. */
export function parseDecisionModelConnections(
  value: string | null | undefined,
): DecisionModelConnection[] {
  return parseConnections<DecisionModelConnection>(value, ["id", "provider", "model", "baseUrl"]);
}

/** Parses the stored LLM_PROVIDERS value into connection rows. */
export function parseLlmConnections(value: string | null | undefined): LlmConnection[] {
  return parseConnections<LlmConnection>(value, ["id", "provider", "model", "baseUrl"]);
}

/** Parses the stored SEARCH_PROVIDERS value into connection rows. */
export function parseSearchConnections(value: string | null | undefined): SearchConnection[] {
  return parseConnections<SearchConnection>(value, ["id", "provider", "baseUrl"]);
}

/** Parses the stored FINANCE_PROVIDERS value into connection rows. */
export function parseFinanceConnections(value: string | null | undefined): FinanceConnection[] {
  return parseConnections<FinanceConnection>(value, ["id", "provider", "baseUrl"]);
}

/** Fetches a shared report without a session; the token is the credential. */
export async function fetchSharedReport(token: string): Promise<SharedReport> {
  const response = await fetch(`/api/share/report/${encodeURIComponent(token)}`);
  const body = (await response.json().catch(() => ({}))) as {
    report?: SharedReport;
    error?: string;
  };
  if (!response.ok || !body.report) {
    throw new Error(body.error ?? `${response.status} ${response.statusText}`);
  }
  return body.report;
}
