import { ValidationError } from "../core/errors.ts";
import type { Logger } from "../core/logger.ts";
import type { Scheduler } from "../core/scheduler/Scheduler.ts";
import {
  assertChannelType,
  type DeliveryStore,
} from "../domain/delivery/DeliveryRepository.ts";
import type { JobStore } from "../domain/jobs/JobRepository.ts";
import type { TopicStore } from "../domain/topics/TopicRepository.ts";
import type { UserWorkflowStore } from "../domain/workflows/UserWorkflowRepository.ts";

const BUNDLE_VERSION = 1;

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
}

export interface ImportSummary {
  topics: number;
  deliveryChannels: number;
  deliveryAttachments: number;
  userWorkflows: number;
  jobs: number;
}

export interface DataTransferDeps {
  topics: TopicStore;
  userWorkflows: UserWorkflowStore;
  deliveries: DeliveryStore;
  jobs: JobStore;
  scheduler: Scheduler;
  logger: Logger;
}

/**
 * Portable snapshot of everything that is configured by hand (topics,
 * workflows, delivery channels + assignments, schedules). Import merges into
 * the current account: records are matched by name (channels by type + name),
 * and topic references inside workflows and jobs are remapped to the local ids.
 */
export class DataTransfer {
  constructor(private readonly deps: DataTransferDeps) {}

  export(): DataBundle {
    return {
      version: BUNDLE_VERSION,
      exportedAt: Date.now(),
      topics: this.deps.topics.list().map((topic) => ({
        id: topic.id,
        name: topic.name,
        ...(topic.description ? { description: topic.description } : {}),
        muted: topic.muted,
        ...(topic.contextId ? { contextId: topic.contextId } : {}),
      })),
      userWorkflows: this.deps.userWorkflows.list().map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
        inputs: workflow.inputs,
      })),
      deliveryChannels: this.deps.deliveries.channels().map((channel) => ({
        id: channel.id,
        type: channel.type,
        name: channel.name,
        config: channel.config,
        enabled: channel.enabled,
      })),
      deliveryAttachments: this.deps.deliveries.attachments().map((attachment) => ({
        workflow: attachment.workflow,
        step: attachment.step,
        output: attachment.output,
        channelId: attachment.channelId,
      })),
      jobs: this.deps.jobs.list().map((job) => ({
        name: job.name,
        cron: job.cron,
        ...(job.timezone ? { timezone: job.timezone } : {}),
        workflow: job.workflow,
        ...(job.contextId ? { contextId: job.contextId } : {}),
        input: job.input,
        enabled: job.enabled,
      })),
    };
  }

  import(raw: unknown): ImportSummary {
    const bundle = this.parse(raw);
    const summary: ImportSummary = {
      topics: 0,
      deliveryChannels: 0,
      deliveryAttachments: 0,
      userWorkflows: 0,
      jobs: 0,
    };

    const topicIds = this.importTopics(bundle, summary);
    const channelIds = this.importChannels(bundle, summary);
    this.importAttachments(bundle, channelIds, summary);
    this.importWorkflows(bundle, topicIds, summary);
    this.importJobs(bundle, topicIds, summary);

    this.deps.scheduler.reload();
    this.deps.logger.info("data bundle imported", { ...summary });
    return summary;
  }

  private importTopics(bundle: DataBundle, summary: ImportSummary): Map<string, string> {
    const ids = new Map<string, string>();
    const existing = new Map(
      this.deps.topics.list().map((topic) => [topic.name.toLowerCase(), topic.id]),
    );
    for (const topic of bundle.topics) {
      const match = existing.get(topic.name.toLowerCase());
      if (match) {
        ids.set(topic.id, match);
        continue;
      }
      const created = this.deps.topics.add({
        name: topic.name,
        description: topic.description,
        contextId: topic.contextId,
      });
      if (topic.muted) this.deps.topics.update(created.id, { muted: true });
      existing.set(created.name.toLowerCase(), created.id);
      ids.set(topic.id, created.id);
      summary.topics += 1;
    }
    return ids;
  }

  private importChannels(bundle: DataBundle, summary: ImportSummary): Map<string, string> {
    const ids = new Map<string, string>();
    const existing = new Map(
      this.deps.deliveries
        .channels()
        .map((channel) => [`${channel.type}:${channel.name.toLowerCase()}`, channel.id]),
    );
    for (const channel of bundle.deliveryChannels) {
      const key = `${channel.type}:${channel.name.toLowerCase()}`;
      const match = existing.get(key);
      if (match) {
        ids.set(channel.id, match);
        continue;
      }
      assertChannelType(channel.type);
      const created = this.deps.deliveries.createChannel({
        type: channel.type,
        name: channel.name,
        config: channel.config,
        enabled: channel.enabled,
      });
      existing.set(key, created.id);
      ids.set(channel.id, created.id);
      summary.deliveryChannels += 1;
    }
    return ids;
  }

  private importAttachments(
    bundle: DataBundle,
    channelIds: Map<string, string>,
    summary: ImportSummary,
  ): void {
    for (const attachment of bundle.deliveryAttachments) {
      const channelId = channelIds.get(attachment.channelId);
      if (!channelId) continue;
      this.deps.deliveries.attach(
        { workflow: attachment.workflow, step: attachment.step, output: attachment.output },
        channelId,
      );
      summary.deliveryAttachments += 1;
    }
  }

  private importWorkflows(
    bundle: DataBundle,
    topicIds: Map<string, string>,
    summary: ImportSummary,
  ): void {
    for (const workflow of bundle.userWorkflows) {
      // Keyed by the exported id so customizations of built-in workflows
      // (which reuse the built-in's id) survive the migration.
      this.deps.userWorkflows.upsert(workflow.id, {
        name: workflow.name,
        inputs: remapTopicIds(workflow.inputs, topicIds),
      });
      summary.userWorkflows += 1;
    }
  }

  private importJobs(
    bundle: DataBundle,
    topicIds: Map<string, string>,
    summary: ImportSummary,
  ): void {
    const existing = new Map(
      this.deps.jobs.list().map((job) => [job.name.toLowerCase(), job.id]),
    );
    for (const job of bundle.jobs) {
      const input = remapTopicIds(job.input, topicIds);
      const match = existing.get(job.name.toLowerCase());
      if (match) {
        this.deps.jobs.update(match, {
          cron: job.cron,
          timezone: job.timezone,
          input,
          enabled: job.enabled,
        });
      } else {
        this.deps.jobs.create({
          name: job.name,
          cron: job.cron,
          timezone: job.timezone,
          workflow: job.workflow,
          contextId: job.contextId,
          input,
          enabled: job.enabled,
        });
      }
      summary.jobs += 1;
    }
  }

  private parse(raw: unknown): DataBundle {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ValidationError("Import expects an exported bundle object");
    }
    const record = raw as Record<string, unknown>;
    if (record.version !== BUNDLE_VERSION) {
      throw new ValidationError(
        `Unsupported bundle version ${String(record.version)} (expected ${BUNDLE_VERSION})`,
      );
    }
    const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    return {
      version: BUNDLE_VERSION,
      exportedAt: typeof record.exportedAt === "number" ? record.exportedAt : Date.now(),
      topics: list(record.topics),
      userWorkflows: list(record.userWorkflows),
      deliveryChannels: list(record.deliveryChannels),
      deliveryAttachments: list(record.deliveryAttachments),
      jobs: list(record.jobs),
    };
  }
}

/** Rewrites `inputs.topics` (a list of topic ids) through the import mapping. */
function remapTopicIds(
  input: Record<string, unknown>,
  ids: Map<string, string>,
): Record<string, unknown> {
  const topics = input.topics;
  if (!Array.isArray(topics)) return input;
  return {
    ...input,
    topics: topics.map((id) => (typeof id === "string" ? ids.get(id) ?? id : id)),
  };
}
