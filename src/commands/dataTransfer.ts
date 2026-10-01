import type { SettingsService, StoredSetting } from "../config/settings.ts";
import { ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
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
const SOURCE = "data-import";

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
  /** User-specific settings and API keys stored in the database. */
  settings: StoredSetting[];
}

export interface ImportSummary {
  topics: number;
  deliveryChannels: number;
  deliveryAttachments: number;
  userWorkflows: number;
  jobs: number;
  settings: number;
}

export interface DataTransferDeps {
  topics: TopicStore;
  userWorkflows: UserWorkflowStore;
  deliveries: DeliveryStore;
  jobs: JobStore;
  settings: SettingsService;
  scheduler: Scheduler;
  bus: EventBus;
  logger: Logger;
}

/**
 * Portable snapshot of everything that is configured by hand (topics,
 * workflows, delivery channels + assignments, schedules, user-specific
 * settings and API keys). Import merges into the current account: records are
 * matched by name (channels by type + name), a matched channel adopts the
 * bundle's config and state so exported credentials actually move
 * installations, stored settings overwrite the local overrides, topic
 * references inside workflows and jobs are remapped to the local ids, and
 * every imported record publishes the event the UI and the workflow registry
 * already listen to — so nothing needs a restart.
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
      settings: this.deps.settings.exportStored(),
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
      settings: 0,
    };

    // Settings first: the provider reload they trigger is done before the
    // rest of the bundle lands.
    summary.settings = this.deps.settings.importStored(bundle.settings);
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
      this.deps.bus.publish(
        "topic.created",
        {
          id: created.id,
          name: created.name,
          description: created.description,
          muted: topic.muted,
        },
        { source: SOURCE },
      );
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
      assertChannelType(channel.type);
      const key = `${channel.type}:${channel.name.toLowerCase()}`;
      const match = existing.get(key);
      if (match) {
        // Same channel, moved between installations: the bundle carries the
        // live configuration (including credentials), so it wins over the
        // local row instead of being silently ignored.
        this.deps.deliveries.updateChannel(match, {
          config: channel.config,
          enabled: channel.enabled,
        });
        this.deps.bus.publish("delivery.updated", { action: "update" }, { source: SOURCE });
        ids.set(channel.id, match);
        summary.deliveryChannels += 1;
        continue;
      }
      const created = this.deps.deliveries.createChannel({
        type: channel.type,
        name: channel.name,
        config: channel.config,
        enabled: channel.enabled,
      });
      this.deps.bus.publish("delivery.updated", { action: "create" }, { source: SOURCE });
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
      this.deps.bus.publish("delivery.updated", { action: "attach" }, { source: SOURCE });
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
      // Registers the workflow in the running registry (and refreshes the UI).
      this.deps.bus.publish(
        "workflow.user.changed",
        { action: "update", workflowId: workflow.id },
        { source: SOURCE },
      );
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
        const saved = this.deps.jobs.update(match, {
          cron: job.cron,
          timezone: job.timezone,
          input,
          enabled: job.enabled,
        });
        this.deps.bus.publish(
          "job.updated",
          { id: saved.id, name: saved.name },
          { source: SOURCE },
        );
      } else {
        const created = this.deps.jobs.create({
          name: job.name,
          cron: job.cron,
          timezone: job.timezone,
          workflow: job.workflow,
          contextId: job.contextId,
          input,
          enabled: job.enabled,
        });
        this.deps.bus.publish(
          "job.created",
          { id: created.id, name: created.name, cron: created.cron, workflow: created.workflow },
          { source: SOURCE },
        );
        existing.set(created.name.toLowerCase(), created.id);
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
      settings: list(record.settings),
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
