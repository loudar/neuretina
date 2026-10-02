import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import type { SettingsService } from "../config/settings.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import { ValidationError, NotFoundError, errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import { markdownToHtml } from "../core/markdown.ts";
import { buildReportMessage } from "../domain/reports/reportMessage.ts";
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
import type { ReportStore } from "../domain/reports/ReportRepository.ts";
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
import {
  DECISION_PROVIDER_PRESETS,
  decisionModelEndpoint,
  isDecisionModelConnection,
  type DecisionModelConnection,
} from "../capabilities/decision/DecisionProviders.ts";
import {
  isSearchConnection,
  type SearchConnection,
} from "../capabilities/search/SearchProviders.ts";
import {
  isFinanceConnection,
  type FinanceConnection,
} from "../capabilities/finance/FinanceProviders.ts";
import {
  activeLlmConnection,
  DEFAULT_LLM_CONNECTION,
  isLlmConnection,
  type LlmConnection,
} from "../capabilities/llm/LlmProviders.ts";
import { createSearchProvider } from "../providers/search/createSearchProvider.ts";
import { createFinanceProvider } from "../providers/finance/createFinanceProvider.ts";
import { createLlmProvider } from "../providers/llm/createLlmProvider.ts";
import { isVerifiable } from "../core/verifiable.ts";
import { SystemOneDecisionModel } from "../providers/decision/SystemOneDecisionModel.ts";
import { DataTransfer } from "./dataTransfer.ts";
import {
  asOptionalRecord,
  asRecord,
  clampNumber,
  optionalString,
  publish,
  publishDeliveryUpdated,
  publishUserWorkflowChanged,
  removeRunArtifacts,
  requireString,
  requireStringArray,
} from "./helpers.ts";

export interface CommandDeps {
  config: AppConfig;
  bus: EventBus;
  logger: Logger;
  contexts: ContextStore;
  runs: WorkflowRunStore;
  runner: WorkflowRunner;
  artifacts: ArtifactStore;
  topics: TopicStore;
  reports: ReportStore;
  jobs: JobStore;
  /** Dated events extracted from reports. */
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
  const { bus, logger, contexts, runs, runner, artifacts, topics, reports, jobs, events, workflows, coreWorkflows, scheduler, statuses, settings, config, delivery, deliveries, userWorkflows } = deps;

  router.register("config.get", () => {
    const matrixChannel = deliveries
      .channels()
      .find((channel) => channel.type === "matrix" && channel.enabled);
    const roomId =
      typeof matrixChannel?.config.roomId === "string" && matrixChannel.config.roomId.trim()
        ? matrixChannel.config.roomId
        : undefined;
    const llm =
      activeLlmConnection(config.llmProviders, config.llmProvider) ?? DEFAULT_LLM_CONNECTION;

    return {
      integrations: { ...configStatus(config), matrix: Boolean(matrixChannel) },
      defaults: config.defaults,
      timezone: config.timezone,
      llm: { provider: llm.provider, model: llm.model, baseUrl: llm.baseUrl },
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

  // Live pre-flight for an LLM connection: a stored connection by id, or the
  // unsaved form values from the LLM settings section. Failures are reported
  // in the result so the UI can show them inline.
  router.register("llm.provider.verify", async (payload) => {
    const record = asRecord(payload);
    const id = optionalString(record, "id");
    const stored = id
      ? (Array.isArray(config.llmProviders) ? config.llmProviders : []).find(
          (connection) => connection.id === id,
        )
      : undefined;
    if (id && !stored) throw new NotFoundError(`LLM provider ${id} not found`);

    const connection = stored ?? adHocLlmConnection(record);
    const provider = createLlmProvider(connection, crypto.randomUUID());

    try {
      return { ok: true, detail: await provider.verify() };
    } catch (error) {
      return { ok: false, detail: errorMessage(error) };
    }
  });

  // Live pre-flight for a hosted decision model: a stored connection by id,
  // or the unsaved form values from the Decision models settings section.
  // Failures are reported in the result so the UI can show them inline.
  router.register("decision.model.verify", async (payload) => {
    const record = asRecord(payload);
    const id = optionalString(record, "id");
    const stored = id
      ? (Array.isArray(config.decisionModels) ? config.decisionModels : []).find(
          (connection) => connection.id === id,
        )
      : undefined;
    if (id && !stored) throw new NotFoundError(`Decision model ${id} not found`);

    const connection = stored ?? adHocDecisionConnection(record);
    const endpoint = decisionModelEndpoint(connection);
    if (!endpoint) throw new ValidationError("The decision-model connection is incomplete");

    const model = new SystemOneDecisionModel({
      id: connection.id,
      provider: DECISION_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider,
      model: connection.model,
      endpoint,
      ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    });

    try {
      return { ok: true, detail: await model.verify() };
    } catch (error) {
      return { ok: false, detail: errorMessage(error) };
    }
  });

  // Live pre-flight for a web-search connection: a stored connection by id,
  // or the unsaved form values from the Web search settings section.
  router.register("search.provider.verify", async (payload) => {
    const record = asRecord(payload);
    const id = optionalString(record, "id");
    const stored = id
      ? (Array.isArray(config.searchProviders) ? config.searchProviders : []).find(
          (connection) => connection.id === id,
        )
      : undefined;
    if (id && !stored) throw new NotFoundError(`Search provider ${id} not found`);

    const connection = stored ?? adHocSearchConnection(record);
    const provider = createSearchProvider(connection, {
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

    try {
      return { ok: true, detail: isVerifiable(provider) ? await provider.verify() : "configured" };
    } catch (error) {
      return { ok: false, detail: errorMessage(error) };
    }
  });

  // Live pre-flight for a finance-data connection: a stored connection by id,
  // or the unsaved form values from the Finance data settings section.
  router.register("finance.provider.verify", async (payload) => {
    const record = asRecord(payload);
    const id = optionalString(record, "id");
    const stored = id
      ? (Array.isArray(config.financeProviders) ? config.financeProviders : []).find(
          (connection) => connection.id === id,
        )
      : undefined;
    if (id && !stored) throw new NotFoundError(`Finance provider ${id} not found`);

    const connection = stored ?? adHocFinanceConnection(record);
    const provider = createFinanceProvider(connection);

    try {
      return { ok: true, detail: isVerifiable(provider) ? await provider.verify() : "configured" };
    } catch (error) {
      return { ok: false, detail: errorMessage(error) };
    }
  });

  router.register("topic.list", (payload) => topics.list(optionalString(asRecord(payload), "contextId")));

  router.register("topic.create", (payload, context) => {
    const record = asRecord(payload);
    const topic = topics.add({
      name: requireString(record, "name"),
      description: optionalString(record, "description"),
      contextId: optionalString(record, "contextId"),
    });
    publish(bus, "topic.created", { id: topic.id, name: topic.name, description: topic.description, muted: topic.muted }, context);
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
    publish(bus, "topic.updated", { id: topic.id, name: topic.name, description: topic.description, muted: topic.muted }, context);
    return topic;
  });

  router.register("topic.delete", (payload, context) => {
    const topic = topics.remove(requireString(asRecord(payload), "id"));
    publish(bus, "topic.deleted", { id: topic.id, name: topic.name }, context);
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
    publish(bus, "job.created", { id: job.id, name: job.name, cron: job.cron, workflow: job.workflow }, context);
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
    publish(bus, "job.updated", { id: job.id, name: job.name }, context);
    return job;
  });

  router.register("job.delete", (payload, context) => {
    const job = jobs.remove(requireString(asRecord(payload), "id"));
    scheduler.unregister(job.id);
    publish(bus, "job.deleted", { id: job.id, name: job.name }, context);
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
      return user
        ? {
            ...info,
            user: true,
            inputValues: user.inputs,
            ...(user.stopAfter ? { stopAfter: user.stopAfter } : {}),
          }
        : info;
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
  // are collected by correlation id, so children (e.g. a report's audio) are
  // covered; removing a parent also cascades to anything referencing it.
  router.register("workflow.run.delete", (payload, context) => {
    const record = asRecord(payload);
    const withArtifacts = record.artifacts === true;
    const run = runs.remove(requireString(record, "id"));
    statuses.removeByCorrelation(run.id);

    const removedArtifacts = withArtifacts
      ? removeRunArtifacts({ artifacts, bus }, run.id, context)
      : 0;

    publish(bus, "workflow.deleted", { correlationId: run.id, workflow: run.workflow, artifacts: removedArtifacts }, context);
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

        const removedArtifacts = removeRunArtifacts({ artifacts, bus }, id, context);

        runs.remove(id);
        statuses.removeByCorrelation(id);
        publish(bus, "workflow.deleted", { correlationId: id, workflow: run.workflow, artifacts: removedArtifacts }, context);
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
        detail: { source: context.source, correlationId: context.correlationId },
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
    const definition = userWorkflowTemplate(coreWorkflows);
    const stopAfter = validateStopAfter(definition, record.stopAfter);
    const workflow = userWorkflows.add({
      name: requireString(record, "name"),
      inputs: validateWorkflowInputs(definition, record.inputs, topics),
      ...(stopAfter ? { stopAfter } : {}),
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
      const definition = workflows.get(id).definition;
      const stopAfter = validateStopAfter(definition, record.stopAfter);
      const workflow = userWorkflows.upsert(id, {
        name: record.name !== undefined ? requireString(record, "name") : id,
        inputs: validateWorkflowInputs(definition, record.inputs, topics),
        ...(stopAfter ? { stopAfter } : {}),
      });
      publishUserWorkflowChanged(bus, "update", workflow.id, context.correlationId);
      return toUserWorkflowInfo(workflow);
    }

    const patch: { name?: string; inputs?: Record<string, unknown>; stopAfter?: string | null } = {};
    if (record.name !== undefined) patch.name = requireString(record, "name");
    if (record.inputs !== undefined) {
      patch.inputs = validateWorkflowInputs(workflows.get(id).definition, record.inputs, topics);
    }
    if (record.stopAfter !== undefined) {
      patch.stopAfter =
        record.stopAfter === null
          ? null
          : (validateStopAfter(workflows.get(id).definition, record.stopAfter) ?? null);
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

  router.register("report.list", (payload) => {
    const record = asRecord(payload);
    const limit = typeof record.limit === "number" ? Math.min(Math.max(1, record.limit), 200) : 50;
    return reports.list(limit);
  });

  router.register("report.get", (payload) => {
    const record = asRecord(payload);
    return reports.get(requireString(record, "id"));
  });

  // The anonymous read-only link for a report: the share token is created on
  // first use. The URL is absolute when APP_URL is configured, else relative
  // so the web can prefix its own origin.
  router.register("report.share", (payload) => {
    const id = requireString(asRecord(payload), "id");
    reports.get(id);
    const token = reports.shareToken(id);
    if (!token) throw new Error("Sharing is not available for this report");
    const base = (config.appUrl ?? "").replace(/\/+$/, "");
    const path = `/reports/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`;
    return { token, url: base ? `${base}${path}` : path };
  });

  router.register("report.audio", (payload) => {
    const id = requireString(asRecord(payload), "id");
    const audio = reports.getAudio(id);
    if (!audio) return null;
    const report = reports.get(id);
    return {
      dataUrl: `data:${audio.mimeType};base64,${Buffer.from(audio.audio).toString("base64")}`,
      mimeType: audio.mimeType,
      durationMs: report.audioDurationMs ?? null,
    };
  });

  router.register("report.delete", (payload, context) => {
    const id = requireString(asRecord(payload), "id");
    const report = reports.remove(id);
    publish(bus, "artifact.deleted", { artifactId: report.artifactId, kind: "report" }, context);
    publish(bus, "report.deleted", { correlationId: context.correlationId, reportId: report.id }, context);
    return { ok: true, reportId: report.id };
  });

  // Generates speech for a stored report on demand (useful for text-only
  // briefings) and delivers it as a voice message through the report's
  // delivery channels.
  router.register("report.audio.generate", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const deliver = record.deliver !== false;
    const regenerate = record.regenerate === true;
    const report = reports.get(id);

    let audio = reports.getAudio(id);
    let durationMs = report.audioDurationMs;
    let generated = false;
    let audioArtifactId = report.audioArtifactId;

    if (!audio || regenerate) {
      const status = statuses.begin(`${context.correlationId}:tts`, "Generating voice", {
        correlationId: context.correlationId,
        detail: report.topics.join(", "),
      });
      try {
        status.update("Waiting for the local TTS server");
        const speech = await deps.tts.synthesize({ text: report.narration });
        audioArtifactId = reports.attachAudio(id, speech.data, speech.mimeType, speech.durationMs);
        audio = { audio: speech.data, mimeType: speech.mimeType };
        durationMs = speech.durationMs;
        generated = true;
        status.done(
          `Speech ready (${Math.round(speech.data.byteLength / 1024)} KB${
            speech.durationMs ? `, ${Math.round(speech.durationMs / 1000)}s` : ""
          })`,
        );
        publish(bus, "artifact.created", {
            artifactId: audioArtifactId,
            kind: "audio",
            parentId: report.artifactId,
            correlationId: context.correlationId,
          }, context);
        publish(bus, "tts.synthesized", {
            correlationId: context.correlationId,
            reportId: id,
            artifactId: report.artifactId,
            audioArtifactId,
            characters: report.narration.length,
            bytes: speech.data.byteLength,
            durationMs: speech.durationMs ?? 0,
          }, context);
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
        const summary = buildReportMessage(report.markdown, report.sources, {
          appUrl: config.appUrl,
          reportId: report.id,
          shareToken: reports.shareToken(report.id),
        });
        // The report's workflow owns the routing: voice goes to the channels
        // assigned to the TTS output of that workflow.
        const voiceTarget = deliveryTargetForKind(
          definitionOf(workflows, report.workflow),
          "tts",
        );
        results = await deps.delivery.deliver({
          reportId: id,
          runId: context.correlationId,
          ...(report.workflow && voiceTarget
            ? {
                target: {
                  workflow: report.workflow,
                  step: voiceTarget.step,
                  output: voiceTarget.output,
                },
              }
            : {}),
          kinds: ["voice"],
          title: report.topics.join(", "),
          summary,
          html: markdownToHtml(summary),
          narration: report.narration,
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
      reportId: id,
      generated,
      bytes: audio.audio.byteLength,
      durationMs: durationMs ?? null,
      results,
      eventId,
    };
  });

  // Re-sends a stored report through the requested delivery channels: the
  // summary as formatted text, plus the audio as a voice message when one
  // exists. Without explicit channels the report workflow's attached channels
  // are used.
  router.register("report.send", async (payload, context) => {
    const record = asRecord(payload);
    const id = requireString(record, "id");
    const channels = optionalChannelIds(record);
    const report = reports.get(id);
    const audio = reports.getAudio(id);

    const text = buildReportMessage(report.markdown, report.sources, {
      appUrl: config.appUrl,
      reportId: report.id,
      shareToken: reports.shareToken(report.id),
    });
    const results = await deps.delivery.deliver({
      reportId: id,
      runId: context.correlationId,
      channels,
      title: report.topics.join(", "),
      summary: text,
      html: markdownToHtml(text),
      narration: report.narration,
      audio: audio?.audio,
      audioMime: audio?.mimeType,
    });

    return { reportId: id, results };
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
      reportId: optionalString(record, "reportId"),
      runId: optionalString(record, "runId"),
    });
  });

  // Dated events extracted from reports (the rows behind timeline artifacts).
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
    if (artifact.kind === "report") reports.forgetShare(artifact.id);
    publish(bus, "artifact.deleted", { artifactId: artifact.id, kind: artifact.kind }, context);
    return { ok: true, artifactId: artifact.id, kind: artifact.kind };
  });

  // Portable snapshot of the hand-configured parts (topics, workflows,
  // delivery channels, schedules, user settings and API keys) for moving an
  // installation.
  const dataTransfer = new DataTransfer({
    topics,
    userWorkflows,
    deliveries,
    jobs,
    settings,
    scheduler,
    bus,
    logger: logger.child("data"),
  });

  router.register("data.export", () => dataTransfer.export());

  router.register("data.import", (payload) => {
    const summary = dataTransfer.import(asRecord(payload).bundle);
    bus.publish("data.imported", summary, { source: "commands" });
    return summary;
  });

  // Backfill for the UI's WebSocket event feed (and any external reader):
  // returns the persisted events after `since`, oldest first.
  router.register("event.pull", (payload) => {
    const record = asRecord(payload);
    const since = typeof record.since === "number" ? record.since : 0;
    const limit = clampNumber(record.limit, 200, 1, 1000);
    return bus.replayAfter(since, limit);
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
    "report.list",
    "report.get",
    "report.audio",
    "report.share",
    "artifact.list",
    "artifact.get",
    "artifact.search",
    "artifact.content",
    "artifact.data",
    "data.export",
    "delivery.channel.list",
    "delivery.workflows",
    "delivery.list",
    "timeline.event.list",
    "event.pull",
  ];
  for (const type of READ_ONLY_TYPES) router.markQuiet(type);
}








function toUserWorkflowInfo(workflow: UserWorkflow): {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  stopAfter?: string;
} {
  return {
    id: workflow.id,
    name: workflow.name,
    inputs: workflow.inputs,
    ...(workflow.stopAfter ? { stopAfter: workflow.stopAfter } : {}),
  };
}

/** Validates a stop-step id against a workflow definition; empty clears it. */
function validateStopAfter(
  definition: WorkflowDefinition,
  value: unknown,
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(`"stopAfter" must be a step id`);
  const step = value.trim();
  if (!step) return undefined;
  if (!definition.steps.some((entry) => entry.id === step)) {
    throw new ValidationError(`Workflow "${definition.id}" has no step "${step}"`);
  }
  return step;
}

/** Validates unsaved LLM form values from the settings dialog. */
function adHocLlmConnection(record: Record<string, unknown>): LlmConnection {
  const candidate: Record<string, unknown> = {
    id: "unsaved",
    provider: record.provider,
    model: record.model,
    baseUrl: record.baseUrl,
  };
  if (typeof record.apiKey === "string") candidate.apiKey = record.apiKey;
  if (!isLlmConnection(candidate)) {
    throw new ValidationError(
      `"provider", "model" and "baseUrl" must describe an LLM connection`,
    );
  }
  return candidate;
}

/** Validates unsaved decision-model form values from the settings dialog. */
function adHocDecisionConnection(record: Record<string, unknown>): DecisionModelConnection {
  const candidate: Record<string, unknown> = {
    id: "unsaved",
    provider: record.provider,
    model: record.model,
    baseUrl: record.baseUrl,
  };
  if (typeof record.accountId === "string") candidate.accountId = record.accountId;
  if (typeof record.apiKey === "string") candidate.apiKey = record.apiKey;
  if (!isDecisionModelConnection(candidate)) {
    throw new ValidationError(
      `"provider", "model" and "baseUrl" must describe a decision-model connection`,
    );
  }
  return candidate;
}

/** Validates unsaved web-search form values from the settings dialog. */
function adHocSearchConnection(record: Record<string, unknown>): SearchConnection {
  const candidate: Record<string, unknown> = {
    id: "unsaved",
    provider: record.provider,
    baseUrl: record.baseUrl,
  };
  if (typeof record.apiKey === "string") candidate.apiKey = record.apiKey;
  if (!isSearchConnection(candidate)) {
    throw new ValidationError(`"provider" and "baseUrl" must describe a web-search connection`);
  }
  return candidate;
}

/** Validates unsaved finance-data form values from the settings dialog. */
function adHocFinanceConnection(record: Record<string, unknown>): FinanceConnection {
  const candidate: Record<string, unknown> = {
    id: "unsaved",
    provider: record.provider,
    model: record.model,
    baseUrl: record.baseUrl,
  };
  if (typeof record.apiKey === "string") candidate.apiKey = record.apiKey;
  if (!isFinanceConnection(candidate)) {
    throw new ValidationError(
      `"provider", "baseUrl" and "model" must describe a finance-data connection`,
    );
  }
  return candidate;
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

/** Optional array of channel ids (`report.send`), validated element-wise. */
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
