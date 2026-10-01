import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import type { SettingsService } from "../config/settings.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import { ValidationError, NotFoundError, errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import { markdownToHtml } from "../core/markdown.ts";
import { buildBriefMessage } from "../domain/briefs/briefMessage.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import {
  deliveryTargetForKind,
  isDeliveryTarget,
  type WorkflowDefinition,
} from "../core/workflow/definition.ts";
import type { WorkflowRegistry, Workflow } from "../core/workflow/Workflow.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import type { ArtifactStore } from "../domain/artifacts/ArtifactRepository.ts";
import type { BriefStore } from "../domain/briefs/BriefRepository.ts";
import type { ContextStore } from "../domain/contexts/ContextRepository.ts";
import type { EventStore } from "../domain/events/EventRepository.ts";
import type { CreateJobInput, JobStore, UpdateJobInput } from "../domain/jobs/JobRepository.ts";
import { assertJobInput } from "../domain/jobs/JobRepository.ts";
import type { WorkflowRunStore } from "../domain/runs/WorkflowRunRepository.ts";
import type { TopicStore } from "../domain/topics/TopicRepository.ts";
import type {
  UserWorkflow,
  UserWorkflowStore,
} from "../domain/workflows/UserWorkflowRepository.ts";
import type { WorkflowRunner } from "../core/workflow/WorkflowRunner.ts";
import type { DeliveryRouter } from "../delivery/DeliveryService.ts";
import type { DeliveryAttempt } from "../delivery/DeliveryService.ts";
import type {
  DeliveryChannel,
  DeliveryStore,
  DeliveryTarget,
  UpdateChannelInput,
} from "../domain/delivery/DeliveryRepository.ts";
import { assertChannelType } from "../domain/delivery/DeliveryRepository.ts";
import { createDeliverySender } from "../providers/delivery/DeliverySenders.ts";

export interface CommandDeps {
  config: AppConfig;
  bus: EventBus;
  logger: Logger;
  contexts: ContextStore;
  runs: WorkflowRunStore;
  runner: WorkflowRunner;
  artifacts: ArtifactStore;
  topics: TopicStore;
  briefs: BriefStore;
  jobs: JobStore;
  /** Dated events extracted from briefs. */
  events: EventStore;
  workflows: WorkflowRegistry;
  /** Core (built-in) workflow instances by id; customizations are rows under the same id. */
  coreWorkflows: ReadonlyMap<string, Workflow>;
  scheduler: Scheduler;
  delivery: DeliveryRouter;
  deliveries: DeliveryStore;
  userWorkflows: UserWorkflowStore;
  tts: TextToSpeechProvider;
  statuses: StatusHub;
  settings: SettingsService;
}

export function registerCommands(router: CommandRouter, deps: CommandDeps): void {
  const { bus, logger, contexts, runs, runner, artifacts, topics, briefs, jobs, events, workflows, coreWorkflows, scheduler, statuses, settings, config, delivery, deliveries, userWorkflows } = deps;

  router.register("config.get", () => {
    const matrixChannel = deliveries
      .channels()
      .find((channel) => channel.type === "matrix" && channel.enabled);
    const roomId =
      typeof matrixChannel?.config.roomId === "string" && matrixChannel.config.roomId.trim()
        ? matrixChannel.config.roomId
        : undefined;

    return {
      integrations: { ...configStatus(config), matrix: Boolean(matrixChannel) },
      defaults: config.defaults,
      timezone: config.timezone,
      llm: { model: config.llm.model, baseUrl: config.llm.baseUrl },
      tts: {
        provider: config.tts.provider,
        baseUrl:
          config.tts.provider === "elevenlabs"
            ? config.elevenlabs.baseUrl
            : config.qwenTts.baseUrl,
        model:
          config.tts.provider === "elevenlabs"
            ? config.elevenlabs.modelId
            : config.qwenTts.model,
        voiceId:
          config.tts.provider === "elevenlabs"
            ? config.elevenlabs.voiceId
            : config.qwenTts.voiceId,
        outputFormat:
          config.tts.provider === "elevenlabs"
            ? config.elevenlabs.outputFormat
            : config.qwenTts.outputFormat,
      },
      matrix: { roomId },
      bluesky: { pdsUrl: config.bluesky.pdsUrl },
    };
  });

  router.register("settings.list", () => settings.list());

  // Edits land in the SQLite key/value store; a `.env` value always wins
  // (settings.list marks those rows as overridden).
  router.register("settings.set", (payload) => {
    const record = asRecord(payload);
    return settings.set(requireString(record, "key"), record.value);
  });

  router.register("settings.clear", (payload) => {
    return settings.clear(requireString(asRecord(payload), "key"));
  });

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
    const runId = crypto.randomUUID();
    // Failures are recorded as job.failed events by the scheduler.
    void scheduler.runNow(job, runId).catch(() => undefined);
    return { started: true, jobId: job.id, workflow: job.workflow, runId };
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

  router.register("workflow.list", () => {
    const userById = new Map(userWorkflows.list().map((workflow) => [workflow.id, workflow]));
    return workflows.list().map((info) => {
      const user = userById.get(info.id);
      return user ? { ...info, user: true, inputValues: user.inputs } : info;
    });
  });

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

  // Deletes a run (and, on request, every artifact it produced). Artifacts
  // are collected by correlation id, so children (e.g. a brief's audio) are
  // covered; removing a parent also cascades to anything referencing it.
  router.register("workflow.run.delete", (payload, context) => {
    const record = asRecord(payload);
    const withArtifacts = record.artifacts === true;
    const run = runs.remove(requireString(record, "id"));
    statuses.removeByCorrelation(run.id);

    let removedArtifacts = 0;
    if (withArtifacts) {
      for (let round = 0; round < 20; round++) {
        const batch = artifacts.list({ correlationId: run.id, limit: 500 });
        if (batch.length === 0) break;
        for (const artifact of batch) {
          artifacts.remove(artifact.id);
          removedArtifacts += 1;
          bus.publish(
            "artifact.deleted",
            { artifactId: artifact.id, kind: artifact.kind },
            { source: "commands", correlationId: context.correlationId },
          );
        }
      }
    }

    bus.publish(
      "workflow.deleted",
      { correlationId: run.id, workflow: run.workflow, artifacts: removedArtifacts },
      { source: "commands", correlationId: context.correlationId },
    );
    return { ok: true, runId: run.id, artifacts: removedArtifacts };
  });

  // Cancels an active run: the workflow stops at its next checkpoint, then
  // the run and every artifact it produced so far are deleted. The response
  // returns immediately; completion shows up as a `workflow.deleted` event.
  router.register("workflow.run.cancel", (payload, context) => {
    const id = requireString(asRecord(payload), "id");
    const run = runs.get(id);

    void runner
      .cancel(id)
      .then((cancelled) => {
        if (!cancelled) {
          // The run is not active (e.g. the server restarted before it was
          // resumed): still settle the orphaned record before cleaning up.
          if (runs.get(id).status !== "running") return;
          runs.finish(id, { status: "cancelled", output: { cancelled: true } });
        }

        let removedArtifacts = 0;
        for (let round = 0; round < 20; round++) {
          const batch = artifacts.list({ correlationId: id, limit: 500 });
          if (batch.length === 0) break;
          for (const artifact of batch) {
            artifacts.remove(artifact.id);
            removedArtifacts += 1;
            bus.publish(
              "artifact.deleted",
              { artifactId: artifact.id, kind: artifact.kind },
              { source: "commands", correlationId: context.correlationId },
            );
          }
        }

        runs.remove(id);
        statuses.removeByCorrelation(id);
        bus.publish(
          "workflow.deleted",
          { correlationId: id, workflow: run.workflow, artifacts: removedArtifacts },
          { source: "commands", correlationId: context.correlationId },
        );
      })
      .catch((error) => {
        logger.warn("cancelling the run failed", { runId: id, error: errorMessage(error) });
      });

    return { ok: true, runId: id, cancelling: true };
  });

  router.register("workflow.run", (payload, context) => {
    const record = asRecord(payload);
    const workflowId = workflows.get(requireString(record, "id")).definition.id;
    const input = asOptionalRecord(record, "input") ?? {};
    // The run id is known before the (async) run starts, so the UI can open
    // the run immediately; failures are recorded as workflow.failed events.
    const runId = crypto.randomUUID();
    void runner
      .start({
        workflow: workflowId,
        contextId: optionalString(record, "contextId"),
        trigger: "manual",
        input,
        detail: { source: "webhook", correlationId: context.correlationId },
        runId,
      })
      .catch(() => undefined);
    return { started: true, workflow: workflowId, runId };
  });

  // ── User workflows ───────────────────────────────────────────────────────
  // Instances of the briefing pipeline over a chosen subset of topics; the
  // kernel registers each row as a runnable workflow on workflow.user.changed.

  router.register("workflow.user.list", () => userWorkflows.list().map(toUserWorkflowInfo));

  router.register("workflow.user.create", (payload, context) => {
    const record = asRecord(payload);
    const workflow = userWorkflows.add({
      name: requireString(record, "name"),
      inputs: validateWorkflowInputs(userWorkflowTemplate(coreWorkflows), record.inputs, topics),
    });
    publishUserWorkflowChanged(bus, "create", workflow.id, context.correlationId);
    return toUserWorkflowInfo(workflow);
  });

  router.register("workflow.user.update", (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");

    // No row yet: updating a registered (built-in) workflow under its own id
    // starts customizing it, so the UI needs no separate create call. The id
    // stays the workflow's id, keeping scheduled jobs and delivery channel
    // assignments pointing at it.
    if (userWorkflows.get(id) === null) {
      if (!workflows.list().some((workflow) => workflow.id === id)) {
        throw new NotFoundError(`User workflow ${id} not found`);
      }
      const workflow = userWorkflows.upsert(id, {
        name: record.name !== undefined ? requireString(record, "name") : id,
        inputs: validateWorkflowInputs(workflows.get(id).definition, record.inputs, topics),
      });
      publishUserWorkflowChanged(bus, "update", workflow.id, context.correlationId);
      return toUserWorkflowInfo(workflow);
    }

    const patch: { name?: string; inputs?: Record<string, unknown> } = {};
    if (record.name !== undefined) patch.name = requireString(record, "name");
    if (record.inputs !== undefined) {
      patch.inputs = validateWorkflowInputs(workflows.get(id).definition, record.inputs, topics);
    }

    const workflow = userWorkflows.update(id, patch);
    publishUserWorkflowChanged(bus, "update", workflow.id, context.correlationId);
    return toUserWorkflowInfo(workflow);
  });

  router.register("workflow.user.remove", (payload, context) => {
    const id = requireString(asRecord(payload), "id");

    // A core workflow survives losing its customization: scheduled jobs and
    // delivery channels reference the workflow itself, not the name/topics
    // row, so only the row is removed.
    if (coreWorkflows.has(id)) {
      const workflow = userWorkflows.remove(id);
      publishUserWorkflowChanged(bus, "delete", workflow.id, context.correlationId);
      return { ok: true };
    }

    if (jobs.list().some((job) => job.workflow === id)) {
      throw new ValidationError(
        `Workflow ${id} is referenced by a scheduled task; delete or reassign the scheduled task(s) first`,
      );
    }

    const workflow = userWorkflows.remove(id);
    deliveries.detachWorkflow(id);
    publishDeliveryUpdated(bus, "detach", context.correlationId);
    publishUserWorkflowChanged(bus, "delete", workflow.id, context.correlationId);
    return { ok: true };
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
  // briefings) and delivers it as a voice message through the brief's
  // delivery channels.
  router.register("brief.audio.generate", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const deliver = record.deliver !== false;
    const regenerate = record.regenerate === true;
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
        const speech = await deps.tts.synthesize({ text: brief.narration });
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

    let results: DeliveryAttempt[] = [];
    let eventId: string | null = null;
    if (deliver) {
      const sendSpan = statuses.begin(`${context.correlationId}:send`, "Delivering voice message", {
        correlationId: context.correlationId,
      });
      try {
        const summary = buildBriefMessage(brief.markdown, brief.sources, { appUrl: config.appUrl, briefId: brief.id });
        // The brief's workflow owns the routing: voice goes to the channels
        // assigned to the TTS output of that workflow.
        const voiceTarget = deliveryTargetForKind(
          definitionOf(workflows, brief.workflow),
          "tts",
        );
        results = await deps.delivery.deliver({
          briefId: id,
          runId: context.correlationId,
          ...(brief.workflow && voiceTarget
            ? {
                target: {
                  workflow: brief.workflow,
                  step: voiceTarget.step,
                  output: voiceTarget.output,
                },
              }
            : {}),
          kinds: ["voice"],
          summary,
          html: markdownToHtml(summary),
          narration: brief.narration,
          audio: audio.audio,
          audioMime: audio.mimeType,
        });
        const firstSent = results.find((result) => result.status === "sent" && result.eventId);
        eventId = firstSent?.eventId ?? null;
        const sent = results.filter((result) => result.status === "sent").length;
        sendSpan.done(
          sent === results.length
            ? `Voice delivered to ${sent} channel(s)`
            : `Voice delivered to ${sent} channel(s) — ${results.length - sent} failed`,
        );
      } catch (error) {
        sendSpan.failed("Delivering the voice message failed");
        throw error;
      }
    }

    return {
      briefId: id,
      generated,
      bytes: audio.audio.byteLength,
      durationMs: durationMs ?? null,
      results,
      eventId,
    };
  });

  // Re-sends a stored brief through the requested delivery channels: the
  // summary as formatted text, plus the audio as a voice message when one
  // exists. Without explicit channels the brief workflow's attached channels
  // are used.
  router.register("brief.send", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const channels = optionalChannelIds(record);
    const brief = briefs.get(id);
    const audio = briefs.getAudio(id);

    const text = buildBriefMessage(brief.markdown, brief.sources, { appUrl: config.appUrl, briefId: brief.id });
    const results = await deps.delivery.deliver({
      briefId: id,
      runId: context.correlationId,
      channels,
      summary: text,
      html: markdownToHtml(text),
      narration: brief.narration,
      audio: audio?.audio,
      audioMime: audio?.mimeType,
    });

    return { briefId: id, results };
  });

  // ── Delivery channels ────────────────────────────────────────────────────

  router.register("delivery.channel.list", () => deliveries.channels());

  router.register("delivery.channel.create", (payload, context) => {
    const record = asRecord(payload);
    assertChannelType(record.type);
    const channel = deliveries.createChannel({
      type: record.type,
      name: requireString(record, "name"),
      config: asOptionalRecord(record, "config") ?? {},
    });
    publishDeliveryUpdated(bus, "create", context.correlationId);
    return channel;
  });

  router.register("delivery.channel.update", (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");

    const patch: UpdateChannelInput = {};
    if (record.name !== undefined) patch.name = requireString(record, "name");
    if (record.config !== undefined) patch.config = asOptionalRecord(record, "config");
    if (record.enabled !== undefined) {
      if (typeof record.enabled !== "boolean") {
        throw new ValidationError(`"enabled" must be a boolean`);
      }
      patch.enabled = record.enabled;
    }

    const channel = deliveries.updateChannel(id, patch);
    publishDeliveryUpdated(bus, "update", context.correlationId);
    return channel;
  });

  router.register("delivery.channel.delete", (payload, context) => {
    const channel: DeliveryChannel = deliveries.removeChannel(
      requireString(asRecord(payload), "id"),
    );
    logger.info("delivery channel deleted", { id: channel.id, type: channel.type });
    publishDeliveryUpdated(bus, "delete", context.correlationId);
    return { ok: true };
  });

  // Live check of one channel's configuration; failures are reported in the
  // result (not as an error) so the UI can show the reason inline.
  router.register("delivery.channel.verify", async (payload) => {
    const channel = deliveries.channel(requireString(asRecord(payload), "id"));
    try {
      const sender = createDeliverySender(channel.type, channel.config);
      return { ok: true, detail: await sender.verify() };
    } catch (error) {
      return { ok: false, detail: errorMessage(error) };
    }
  });

  router.register("delivery.workflows", () => deliveries.workflows());

  // Every channel assignment with its step-output target, for the workflow
  // editor and for overviews of what is routed where.
  router.register("delivery.attachments", () => deliveries.attachments());

  router.register("delivery.attach", (payload, context) => {
    const target = requireDeliveryTarget(workflows, asRecord(payload));
    deliveries.attach(target, requireString(asRecord(payload), "channelId"));
    publishDeliveryUpdated(bus, "attach", context.correlationId);
    return { ok: true };
  });

  router.register("delivery.detach", (payload, context) => {
    const record = asRecord(payload);
    const target = requireDeliveryTarget(workflows, record);
    deliveries.detach(target, requireString(record, "channelId"));
    publishDeliveryUpdated(bus, "detach", context.correlationId);
    return { ok: true };
  });

  router.register("delivery.list", (payload) => {
    const record = asRecord(payload);
    return deliveries.deliveries({
      briefId: optionalString(record, "briefId"),
      runId: optionalString(record, "runId"),
    });
  });

  // Dated events extracted from briefs (the rows behind timeline artifacts).
  // With `ids` this fetches exactly the events a timeline artifact references.
  router.register("timeline.event.list", (payload) => {
    const record = asRecord(payload);
    const raw = record.ids;
    if (raw !== undefined && !Array.isArray(raw)) {
      throw new ValidationError(`"ids" must be an array`);
    }
    const ids = Array.isArray(raw)
      ? raw.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
      : undefined;
    if (ids && ids.length === 0) return [];
    return events.list(ids ? { ids } : { limit: 200 });
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

  router.register("artifact.search", (payload) => {
    const record = asRecord(payload);
    const limit = typeof record.limit === "number" ? record.limit : 100;
    return artifacts.search(optionalString(record, "query"), {
      kind: optionalString(record, "kind"),
      contextId: optionalString(record, "contextId"),
      limit,
    });
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
  // and the persisted event log only contains real activity. Settings edits
  // are quiet too: their payload carries secrets, so they are audited through
  // the value-free `settings.updated` event instead.
  const READ_ONLY_TYPES = [
    "config.get",
    "settings.list",
    "settings.set",
    "settings.clear",
    "context.list",
    "topic.list",
    "job.list",
    "workflow.list",
    "workflow.user.list",
    "workflow.run.list",
    "workflow.run.get",
    "brief.list",
    "brief.get",
    "brief.audio",
    "artifact.list",
    "artifact.get",
    "artifact.search",
    "artifact.content",
    "artifact.data",
    "delivery.channel.list",
    "delivery.workflows",
    "delivery.list",
    "timeline.event.list",
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

function publishDeliveryUpdated(
  bus: EventBus,
  action: "create" | "update" | "delete" | "attach" | "detach",
  correlationId?: string,
): void {
  bus.publish("delivery.updated", { action }, { source: "commands", correlationId });
}

function publishUserWorkflowChanged(
  bus: EventBus,
  action: "create" | "update" | "delete",
  workflowId: string,
  correlationId?: string,
): void {
  bus.publish(
    "workflow.user.changed",
    { action, workflowId },
    { source: "commands", correlationId },
  );
}

function toUserWorkflowInfo(workflow: UserWorkflow): {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
} {
  return { id: workflow.id, name: workflow.name, inputs: workflow.inputs };
}

/** The definition user workflow instances are built from (the briefing pipeline). */
function userWorkflowTemplate(coreWorkflows: ReadonlyMap<string, Workflow>): WorkflowDefinition {
  const template = coreWorkflows.get("briefing");
  if (!template) throw new NotFoundError("The briefing workflow is not registered");
  return template.definition;
}

/**
 * Validates configured input values against a workflow definition. Every
 * required input must hold a value and each known kind gets its own check
 * (topics must reference existing topic ids); unknown kinds pass through.
 */
function validateWorkflowInputs(
  definition: WorkflowDefinition,
  value: unknown,
  topics: TopicStore,
): Record<string, unknown> {
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const result: Record<string, unknown> = {};

  for (const spec of definition.inputs) {
    const raw = record[spec.id];

    if (spec.kind === "topics") {
      const ids = raw === undefined ? [] : requireStringArray(raw, spec.id);
      const known = new Set(topics.list().map((topic) => topic.id));
      for (const id of ids) {
        if (!known.has(id)) throw new ValidationError(`Topic ${id} not found`);
      }
      const unique = [...new Set(ids)];
      if (spec.required && unique.length === 0) {
        throw new ValidationError(`"${spec.id}" must be a non-empty array of topic ids`);
      }
      result[spec.id] = unique;
      continue;
    }

    if (raw !== undefined) result[spec.id] = raw;
  }

  return result;
}

/** Array of non-empty strings, used by the kind-specific input checks. */
function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`"${field}" must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ValidationError(`"${field}[${index}]" must be a non-empty string`);
    }
    return entry.trim();
  });
}

/** Validates a (workflow, step, output) channel-assignment target. */
function requireDeliveryTarget(
  workflows: WorkflowRegistry,
  record: Record<string, unknown>,
): DeliveryTarget {
  const workflow = requireString(record, "workflow");
  const step = requireString(record, "step");
  const output = requireString(record, "output");
  const definition = workflows.get(workflow).definition;
  if (!isDeliveryTarget(definition, step, output)) {
    throw new ValidationError(
      `Workflow "${workflow}" has no deliverable output "${step}.${output}"`,
    );
  }
  return { workflow, step, output };
}

/** Definition of a registered workflow, or undefined when it no longer exists. */
function definitionOf(
  workflows: WorkflowRegistry,
  id: string | undefined,
): WorkflowDefinition | undefined {
  if (!id) return undefined;
  try {
    return workflows.get(id).definition;
  } catch {
    return undefined;
  }
}

/** Optional array of channel ids (`brief.send`), validated element-wise. */
function optionalChannelIds(record: Record<string, unknown>): string[] | undefined {
  const value = record.channels;
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`"channels" must be an array of channel ids`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ValidationError(`"channels[${index}]" must be a non-empty string`);
    }
    return entry.trim();
  });
}

export function eventWaitTimeoutMs(payload: unknown): number {
  const record = asRecord(payload);
  return clampNumber(record.timeoutMs, 25_000, 1_000, 55_000);
}



