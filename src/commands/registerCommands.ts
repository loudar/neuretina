import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import { ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import type { WorkflowRegistry } from "../core/workflow/Workflow.ts";
import type { BriefRepository } from "../domain/briefs/BriefRepository.ts";
import type { CreateJobInput, JobRepository, UpdateJobInput } from "../domain/jobs/JobRepository.ts";
import { assertJobInput } from "../domain/jobs/JobRepository.ts";
import type { TopicRepository } from "../domain/topics/TopicRepository.ts";

export interface CommandDeps {
  config: AppConfig;
  bus: EventBus;
  topics: TopicRepository;
  briefs: BriefRepository;
  jobs: JobRepository;
  workflows: WorkflowRegistry;
  scheduler: Scheduler;
}

export function registerCommands(router: CommandRouter, deps: CommandDeps): void {
  const { bus, topics, briefs, jobs, workflows, scheduler, config } = deps;

  router.register("config.get", () => ({
    integrations: configStatus(config),
    defaults: config.defaults,
    timezone: config.timezone,
    llm: { model: config.llm.model, baseUrl: config.llm.baseUrl },
    elevenlabs: {
      modelId: config.elevenlabs.modelId,
      voiceId: config.elevenlabs.voiceId,
      outputFormat: config.elevenlabs.outputFormat,
    },
    matrix: { roomId: config.matrix.roomId },
    bluesky: { pdsUrl: config.bluesky.pdsUrl },
  }));

  router.register("topic.list", () => topics.list());

  router.register("topic.create", (payload, context) => {
    const record = asRecord(payload);
    const topic = topics.add({
      name: requireString(record, "name"),
      description: optionalString(record, "description"),
    });
    bus.publish(
      "topic.created",
      { id: topic.id, name: topic.name, description: topic.description },
      { source: "commands", correlationId: context.correlationId },
    );
    return topic;
  });

  router.register("topic.delete", (payload, context) => {
    const topic = topics.remove(requireString(asRecord(payload), "id"));
    bus.publish(
      "topic.deleted",
      { id: topic.id, name: topic.name },
      { source: "commands", correlationId: context.correlationId },
    );
    return { ok: true };
  });

  router.register("job.list", () => jobs.list());

  router.register("job.create", (payload, context) => {
    const record = asRecord(payload);
    const input: CreateJobInput = {
      name: requireString(record, "name"),
      cron: requireString(record, "cron"),
      timezone: optionalString(record, "timezone"),
      workflow: requireString(record, "workflow"),
      input: asOptionalRecord(record, "input"),
      enabled: typeof record.enabled === "boolean" ? record.enabled : undefined,
    };

    assertJobInput(input);
    workflows.get(input.workflow);
    Scheduler.validateCron(input.cron, input.timezone);

    const job = jobs.create(input);
    scheduler.register(job);
    bus.publish(
      "job.created",
      { id: job.id, name: job.name, cron: job.cron, workflow: job.workflow },
      { source: "commands", correlationId: context.correlationId },
    );
    return job;
  });

  router.register("job.update", (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");

    const patch: UpdateJobInput = {};
    if (record.name !== undefined) patch.name = requireString(record, "name");
    if (record.cron !== undefined) patch.cron = requireString(record, "cron");
    if (record.timezone !== undefined) patch.timezone = optionalString(record, "timezone");
    if (record.enabled !== undefined) {
      if (typeof record.enabled !== "boolean") throw new ValidationError(`"enabled" must be a boolean`);
      patch.enabled = record.enabled;
    }
    if (record.input !== undefined) patch.input = asOptionalRecord(record, "input");

    if (patch.cron !== undefined) Scheduler.validateCron(patch.cron, patch.timezone);

    const job = jobs.update(id, patch);
    if (job.enabled) scheduler.register(job);
    else scheduler.unregister(job.id);
    bus.publish(
      "job.updated",
      { id: job.id, name: job.name },
      { source: "commands", correlationId: context.correlationId },
    );
    return job;
  });

  router.register("job.delete", (payload, context) => {
    const job = jobs.remove(requireString(asRecord(payload), "id"));
    scheduler.unregister(job.id);
    bus.publish(
      "job.deleted",
      { id: job.id, name: job.name },
      { source: "commands", correlationId: context.correlationId },
    );
    return { ok: true };
  });

  router.register("job.run", (payload) => {
    const job = jobs.get(requireString(asRecord(payload), "id"));
    // Failures are recorded as job.failed events by the scheduler.
    void scheduler.runNow(job).catch(() => undefined);
    return { started: true, jobId: job.id, workflow: job.workflow };
  });

  router.register("workflow.list", () => workflows.list());

  router.register("workflow.run", (payload) => {
    const record = asRecord(payload);
    const workflow = workflows.get(requireString(record, "id"));
    const input = asOptionalRecord(record, "input") ?? {};
    // Failures are recorded as workflow.failed events by the registry.
    void workflows.run(workflow.id, input).catch(() => undefined);
    return { started: true, workflow: workflow.id };
  });

  router.register("brief.list", (payload) => {
    const record = asRecord(payload);
    const limit = typeof record.limit === "number" ? Math.min(Math.max(1, record.limit), 200) : 50;
    return briefs.list(limit);
  });

  router.register("brief.get", (payload) => {
    const record = asRecord(payload);
    return briefs.get(requireString(record, "id"));
  });

  router.register("brief.audio", (payload) => {
    const id = requireString(asRecord(payload), "id");
    const audio = briefs.getAudio(id);
    if (!audio) return null;
    const brief = briefs.get(id);
    return {
      dataUrl: `data:${audio.mimeType};base64,${Buffer.from(audio.audio).toString("base64")}`,
      mimeType: audio.mimeType,
      durationMs: brief.audioDurationMs ?? null,
    };
  });

  router.register("event.pull", (payload) => {
    const record = asRecord(payload);
    const since = typeof record.since === "number" ? record.since : 0;
    const limit = clampNumber(record.limit, 200, 1, 1000);
    return bus.replayAfter(since, limit);
  });

  // Long-poll: returns as soon as an event newer than `since` exists, or an
  // empty list after `timeoutMs`. The UI loops on this to get its event feed.
  router.register("event.wait", async (payload) => {
    const record = asRecord(payload);
    const since = typeof record.since === "number" ? record.since : 0;
    const timeoutMs = clampNumber(record.timeoutMs, 25_000, 1_000, 55_000);
    const limit = 200;

    const backlog = bus.replayAfter(since, limit);
    if (backlog.length > 0) return backlog;

    return new Promise<unknown[]>((resolve) => {
      let unsubscribe: (() => void) | null = null;
      const timer = setTimeout(() => {
        unsubscribe?.();
        resolve([]);
      }, timeoutMs);

      unsubscribe = bus.subscribe("*", (event) => {
        if (event.seq <= since) return;
        clearTimeout(timer);
        unsubscribe?.();
        resolve(bus.replayAfter(since, limit));
      });
    });
  });

  // Read-only message types: no audit events, so polling cannot feed itself
  // and the persisted event log only contains real activity.
  const READ_ONLY_TYPES = [
    "config.get",
    "topic.list",
    "job.list",
    "workflow.list",
    "brief.list",
    "brief.get",
    "brief.audio",
    "event.pull",
    "event.wait",
  ];
  for (const type of READ_ONLY_TYPES) router.markQuiet(type);
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function asOptionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`"${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(`"${key}" must be a string`);
  return value.trim() || undefined;
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

export function eventWaitTimeoutMs(payload: unknown): number {
  const record = asRecord(payload);
  return clampNumber(record.timeoutMs, 25_000, 1_000, 55_000);
}



