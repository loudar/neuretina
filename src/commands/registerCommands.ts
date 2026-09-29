import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import { ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import { markdownToHtml } from "../core/markdown.ts";
import { buildBriefMessage } from "../domain/briefs/briefMessage.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import type { WorkflowRegistry } from "../core/workflow/Workflow.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import type { ArtifactStore } from "../domain/artifacts/ArtifactRepository.ts";
import type { BriefStore } from "../domain/briefs/BriefRepository.ts";
import type { ContextStore } from "../domain/contexts/ContextRepository.ts";
import type { CreateJobInput, JobStore, UpdateJobInput } from "../domain/jobs/JobRepository.ts";
import { assertJobInput } from "../domain/jobs/JobRepository.ts";
import type { WorkflowRunStore } from "../domain/runs/WorkflowRunRepository.ts";
import type { TopicStore } from "../domain/topics/TopicRepository.ts";
import type { WorkflowRunner } from "../core/workflow/WorkflowRunner.ts";

export interface CommandDeps {
  config: AppConfig;
  bus: EventBus;
  contexts: ContextStore;
  runs: WorkflowRunStore;
  runner: WorkflowRunner;
  artifacts: ArtifactStore;
  topics: TopicStore;
  briefs: BriefStore;
  jobs: JobStore;
  workflows: WorkflowRegistry;
  scheduler: Scheduler;
  messaging: MessagingProvider;
  tts: TextToSpeechProvider;
  statuses: StatusHub;
}

export function registerCommands(router: CommandRouter, deps: CommandDeps): void {
  const { bus, contexts, runs, runner, artifacts, topics, briefs, jobs, workflows, scheduler, messaging, tts, statuses, config } = deps;

  router.register("config.get", () => ({
    integrations: configStatus(config),
    defaults: config.defaults,
    timezone: config.timezone,
    llm: { model: config.llm.model, baseUrl: config.llm.baseUrl },
    tts: {
      provider: "qwen-tts",
      baseUrl: config.qwenTts.baseUrl,
      model: config.qwenTts.model,
      voiceId: config.qwenTts.voiceId,
      outputFormat: config.qwenTts.outputFormat,
    },
    matrix: { roomId: config.matrix.roomId },
    bluesky: { pdsUrl: config.bluesky.pdsUrl },
  }));

  router.register("topic.list", (payload) => topics.list(optionalString(asRecord(payload), "contextId")));

  router.register("topic.create", (payload, context) => {
    const record = asRecord(payload);
    const topic = topics.add({
      name: requireString(record, "name"),
      description: optionalString(record, "description"),
      contextId: optionalString(record, "contextId"),
    });
    bus.publish(
      "topic.created",
      { id: topic.id, name: topic.name, description: topic.description, muted: topic.muted },
      { source: "commands", correlationId: context.correlationId },
    );
    return topic;
  });

  router.register("topic.update", (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const patch: { name?: string; description?: string; muted?: boolean } = {};

    if (record.name !== undefined) patch.name = requireString(record, "name");
    if (record.description !== undefined) {
      if (typeof record.description !== "string") {
        throw new ValidationError(`"description" must be a string`);
      }
      patch.description = record.description;
    }
    if (record.muted !== undefined) {
      if (typeof record.muted !== "boolean") {
        throw new ValidationError(`"muted" must be a boolean`);
      }
      patch.muted = record.muted;
    }

    const topic = topics.update(id, patch);
    bus.publish(
      "topic.updated",
      { id: topic.id, name: topic.name, description: topic.description, muted: topic.muted },
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
      contextId: optionalString(record, "contextId"),
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

  router.register("context.list", () => {
    return contexts.list().map((context) => ({
      ...context,
      topics: topics.list(context.id).length,
      jobs: jobs.list().filter((job) => job.contextId === context.id).length,
      runs: runs.list({ contextId: context.id, limit: 500 }).length,
      artifacts: artifacts.list({ contextId: context.id, limit: 500 }).length,
    }));
  });

  router.register("workflow.list", () => workflows.list());

  router.register("workflow.run.list", (payload) => {
    const record = asRecord(payload);
    const limit = typeof record.limit === "number" ? Math.min(Math.max(1, record.limit), 200) : 50;
    return runs.list({
      contextId: optionalString(record, "contextId"),
      workflow: optionalString(record, "workflow"),
      limit,
    });
  });

  router.register("workflow.run.get", (payload) => {
    const run = runs.get(requireString(asRecord(payload), "id"));
    return {
      ...run,
      artifacts: artifacts.list({ correlationId: run.id, limit: 100 }),
    };
  });

  router.register("workflow.run", (payload, context) => {
    const record = asRecord(payload);
    const workflow = workflows.get(requireString(record, "id"));
    const input = asOptionalRecord(record, "input") ?? {};
    // Failures are recorded as workflow.failed events by the runner.
    void runner
      .start({
        workflow: workflow.id,
        contextId: optionalString(record, "contextId"),
        trigger: "manual",
        input,
        detail: { source: "webhook", correlationId: context.correlationId },
      })
      .catch(() => undefined);
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

  router.register("brief.delete", (payload, context) => {
    const id = requireString(asRecord(payload), "id");
    const brief = briefs.remove(id);
    bus.publish(
      "artifact.deleted",
      { artifactId: brief.artifactId, kind: "brief" },
      { source: "commands", correlationId: context.correlationId },
    );
    bus.publish(
      "brief.deleted",
      { correlationId: context.correlationId, briefId: brief.id },
      { source: "commands", correlationId: context.correlationId },
    );
    return { ok: true, briefId: brief.id };
  });

  // Generates speech for a stored brief on demand (useful for text-only
  // briefings) and auto-sends it to Matrix as a voice message.
  router.register("brief.audio.generate", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const deliver = record.deliver !== false;
    const regenerate = record.regenerate === true;
    const channel = optionalString(record, "channel");
    const brief = briefs.get(id);

    let audio = briefs.getAudio(id);
    let durationMs = brief.audioDurationMs;
    let generated = false;
    let audioArtifactId = brief.audioArtifactId;

    if (!audio || regenerate) {
      const status = statuses.begin(`${context.correlationId}:tts`, "Generating voice", {
        correlationId: context.correlationId,
        detail: brief.topics.join(", "),
      });
      try {
        status.update("Waiting for the local TTS server");
        const speech = await tts.synthesize({ text: brief.narration });
        audioArtifactId = briefs.attachAudio(id, speech.data, speech.mimeType, speech.durationMs);
        audio = { audio: speech.data, mimeType: speech.mimeType };
        durationMs = speech.durationMs;
        generated = true;
        status.done(
          `Speech ready (${Math.round(speech.data.byteLength / 1024)} KB${
            speech.durationMs ? `, ${Math.round(speech.durationMs / 1000)}s` : ""
          })`,
        );
        bus.publish(
          "artifact.created",
          {
            artifactId: audioArtifactId,
            kind: "audio",
            parentId: brief.artifactId,
            correlationId: context.correlationId,
          },
          { source: "commands", correlationId: context.correlationId },
        );
        bus.publish(
          "tts.synthesized",
          {
            correlationId: context.correlationId,
            briefId: id,
            artifactId: brief.artifactId,
            audioArtifactId,
            characters: brief.narration.length,
            bytes: speech.data.byteLength,
            durationMs: speech.durationMs ?? 0,
          },
          { source: "commands", correlationId: context.correlationId },
        );
      } catch (error) {
        status.failed("Speech generation failed");
        throw error;
      }
    }

    let eventId: string | null = null;
    if (deliver) {
      const sendSpan = statuses.begin(`${context.correlationId}:send`, "Sending voice message", {
        correlationId: context.correlationId,
      });
      try {
        sendSpan.update("Waiting for Matrix");
        const sent = await messaging.send({
          kind: "voice",
          audio: audio.audio,
          mimeType: audio.mimeType,
          durationMs,
          filename: `brief-${dateOf(brief.createdAt)}.${extensionFor(audio.mimeType)}`,
          caption: `Brief – ${new Date(brief.createdAt).toLocaleString()}`,
          channel,
        });
        eventId = sent.id;
        sendSpan.done(`Voice message sent (${sent.channel})`);
        bus.publish(
          "message.voice.sent",
          { correlationId: context.correlationId, briefId: id, channel: sent.channel, eventId: sent.id },
          { source: "commands", correlationId: context.correlationId },
        );
      } catch (error) {
        sendSpan.failed("Sending voice message failed");
        throw error;
      }
    }

    return {
      briefId: id,
      generated,
      bytes: audio.audio.byteLength,
      durationMs: durationMs ?? null,
      eventId,
    };
  });

  // Re-sends a stored brief: the summary as formatted text, plus the audio
  // as a voice message when one exists.
  router.register("brief.send", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const channel = optionalString(record, "channel");
    const brief = briefs.get(id);
    const sent: Array<{ kind: "text" | "voice"; eventId: string }> = [];

    const text = buildBriefMessage(brief.markdown, brief.sources);
    const textMessage = await messaging.send({
      kind: "text",
      text,
      html: markdownToHtml(text),
      channel,
    });
    bus.publish(
      "message.text.sent",
      { correlationId: context.correlationId, channel: textMessage.channel, eventId: textMessage.id },
      { source: "commands", correlationId: context.correlationId },
    );
    sent.push({ kind: "text", eventId: textMessage.id });

    const audio = briefs.getAudio(id);
    if (audio) {
      const voice = await messaging.send({
        kind: "voice",
        audio: audio.audio,
        mimeType: audio.mimeType,
        durationMs: brief.audioDurationMs,
        filename: `brief-${dateOf(brief.createdAt)}.${extensionFor(audio.mimeType)}`,
        caption: `Brief – ${new Date(brief.createdAt).toLocaleString()}`,
        channel,
      });
      bus.publish(
        "message.voice.sent",
        { correlationId: context.correlationId, briefId: id, channel: voice.channel, eventId: voice.id },
        { source: "commands", correlationId: context.correlationId },
      );
      sent.push({ kind: "voice", eventId: voice.id });
    }

    return { briefId: id, sent };
  });

  router.register("artifact.list", (payload) => {
    const record = asRecord(payload);
    return artifacts.list({
      kind: optionalString(record, "kind"),
      workflow: optionalString(record, "workflow"),
      parentId: optionalString(record, "parentId"),
      correlationId: optionalString(record, "correlationId"),
      contextId: optionalString(record, "contextId"),
      limit: typeof record.limit === "number" ? record.limit : undefined,
    });
  });

  router.register("artifact.get", (payload) => {
    return artifacts.get(requireString(asRecord(payload), "id"));
  });

  router.register("artifact.content", (payload) => {
    const artifact = artifacts.get(requireString(asRecord(payload), "id"));
    return {
      id: artifact.id,
      kind: artifact.kind,
      contentType: artifact.contentType,
      content: artifact.content ?? null,
    };
  });

  router.register("artifact.data", (payload) => {
    const artifact = artifacts.get(requireString(asRecord(payload), "id"), { includeData: true });
    if (!artifact.data) return null;
    return {
      id: artifact.id,
      kind: artifact.kind,
      contentType: artifact.contentType,
      byteSize: artifact.data.byteLength,
      dataUrl: `data:${artifact.contentType};base64,${Buffer.from(artifact.data).toString("base64")}`,
    };
  });

  router.register("artifact.delete", (payload, context) => {
    const artifact = artifacts.remove(requireString(asRecord(payload), "id"));
    bus.publish(
      "artifact.deleted",
      { artifactId: artifact.id, kind: artifact.kind },
      { source: "commands", correlationId: context.correlationId },
    );
    return { ok: true, artifactId: artifact.id, kind: artifact.kind };
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
    "context.list",
    "topic.list",
    "job.list",
    "workflow.list",
    "workflow.run.list",
    "workflow.run.get",
    "brief.list",
    "brief.get",
    "brief.audio",
    "artifact.list",
    "artifact.get",
    "artifact.content",
    "artifact.data",
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

function dateOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}

export function eventWaitTimeoutMs(payload: unknown): number {
  const record = asRecord(payload);
  return clampNumber(record.timeoutMs, 25_000, 1_000, 55_000);
}



