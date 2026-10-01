import type { AppConfig, Env } from "../config/env.ts";
import { LEGACY_MATRIX_KEYS } from "../config/env.ts";
import { SettingsService } from "../config/settings.ts";
import { errorMessage } from "../core/errors.ts";
import { EventBus } from "../core/events/EventBus.ts";
import { EventStore, type EventLog } from "../core/events/EventStore.ts";
import { CommandRouter } from "../core/commands/CommandRouter.ts";
import type { Logger } from "../core/logger.ts";
import { StatusHub, type StatusStore } from "../core/status/StatusHub.ts";
import { StatusRepository } from "../domain/status/StatusRepository.ts";
import { StatusService } from "../status/StatusService.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import { WorkflowRegistry, type Workflow } from "../core/workflow/Workflow.ts";
import { deliveryTargets, findStep } from "../core/workflow/definition.ts";
import { WorkflowRunner } from "../core/workflow/WorkflowRunner.ts";
import { TriggerDispatcher } from "../core/workflow/Triggers.ts";
import type { SqliteDatabase } from "../infra/db/SqliteDatabase.ts";
import { ArtifactRepository, type ArtifactStore } from "../domain/artifacts/ArtifactRepository.ts";
import { BriefRepository, type BriefStore } from "../domain/briefs/BriefRepository.ts";
import {
  ContextRepository,
  DEFAULT_CONTEXT_ID,
  DEFAULT_CONTEXT_NAME,
  type ContextStore,
} from "../domain/contexts/ContextRepository.ts";
import {
  EventRepository,
  type EventStore as TimelineEventStore,
} from "../domain/events/EventRepository.ts";
import { JobRepository, type JobStore } from "../domain/jobs/JobRepository.ts";
import {
  WorkflowRunRepository,
  type WorkflowRunStore,
} from "../domain/runs/WorkflowRunRepository.ts";
import { TopicRepository, type TopicStore } from "../domain/topics/TopicRepository.ts";
import {
  UserWorkflowRepository,
  type UserWorkflowStore,
} from "../domain/workflows/UserWorkflowRepository.ts";
import {
  DeliveryRepository,
  type DeliveryChannel,
  type DeliveryStore,
} from "../domain/delivery/DeliveryRepository.ts";
import { DeliveryService, type DeliveryRouter } from "../delivery/DeliveryService.ts";
import {
  matrixChannelConfig,
  type MatrixChannelConfig,
} from "../providers/delivery/MatrixDeliveryChannel.ts";
import { BriefingWorkflow } from "../workflows/BriefingWorkflow.ts";
import { createUserWorkflowSync } from "../workflows/UserBriefingWorkflow.ts";
import { QuestionWorkflow } from "../workflows/QuestionWorkflow.ts";
import { registerCommands } from "../commands/registerCommands.ts";
import { StartupService } from "../startup/StartupService.ts";
import { KeyValueRepository, type KeyValueStore } from "../domain/kv/KeyValueRepository.ts";
import { MatrixClient } from "../providers/messaging/MatrixClient.ts";
import { MatrixCommandListener } from "../providers/messaging/MatrixCommandListener.ts";
import { createChatCommandHandler } from "../chat/ChatCommands.ts";
import { OpenAiCompatibleLlmProvider } from "../providers/llm/OpenAiCompatibleLlmProvider.ts";
import { PerplexitySearchProvider } from "../providers/search/PerplexitySearchProvider.ts";
import { ExaSearchProvider } from "../providers/search/ExaSearchProvider.ts";
import { DecisionModelRegistry } from "../capabilities/decision/DecisionModel.ts";
import { LayaOnnxDecisionModel } from "../providers/decision/LayaOnnxDecisionModel.ts";
import { PerplexityFinanceProvider } from "../providers/finance/PerplexityFinanceProvider.ts";
import { BlueskySearchProvider } from "../providers/search/BlueskySearchProvider.ts";
import { QwenTtsProvider } from "../providers/tts/QwenTtsProvider.ts";
import { ElevenLabsTtsProvider } from "../providers/tts/ElevenLabsTtsProvider.ts";
import { MatrixMessagingProvider } from "../providers/messaging/MatrixMessagingProvider.ts";
import type { LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import type { SearchProvider } from "../capabilities/search/SearchProvider.ts";
import type { FinanceProvider } from "../capabilities/finance/FinanceProvider.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import type { UserStore } from "../domain/users/UserRepository.ts";

/** Swap any piece of storage; missing pieces fall back to the SQLite stores. */
export interface KernelStores {
  events?: EventLog;
  contexts?: ContextStore;
  runs?: WorkflowRunStore;
  artifacts?: ArtifactStore;
  topics?: TopicStore;
  briefs?: BriefStore;
  jobs?: JobStore;
  kv?: KeyValueStore;
  statuses?: StatusStore;
  deliveries?: DeliveryStore;
  userWorkflows?: UserWorkflowStore;
  /** Dated events extracted from briefs (`events` is the event log). */
  timelineEvents?: TimelineEventStore;
}

export interface KernelOverrides {
  config?: AppConfig;
  /** Environment used for settings precedence; defaults to Bun.env, or {} with a config override. */
  env?: Env;
  logger?: Logger;
  /** Account store for the control plane (tests swap it in). */
  users?: UserStore;
  /** Storage implementation; the composition root is the only place that picks one. */
  stores?: KernelStores;
  llm?: LlmProvider;
  webSearch?: SearchProvider;
  /** Additional web search providers (e.g. Exa) beyond `webSearch`. */
  exaSearch?: SearchProvider;
  socialSearch?: SearchProvider;
  finance?: FinanceProvider;
  tts?: TextToSpeechProvider;
  messaging?: MessagingProvider;
  delivery?: DeliveryRouter;
}

export interface RuntimeOptions {
  /** Account this runtime belongs to; all of its data lives in `db`. */
  user: string;
  config: AppConfig;
  env: Env;
  logger: Logger;
  db: SqliteDatabase | null;
  /** Close the database when the runtime stops (each non-admin user owns one). */
  ownsDb: boolean;
  overrides: KernelOverrides;
  /** Consume legacy deployment configuration (only the admin's database has it). */
  legacyMigrations: boolean;
  /** Run the boot-time provider validation. */
  runStartup: boolean;
}

/**
 * Everything one user needs: stores, providers, workflows, scheduler, command
 * router and live feeds. The admin runtime owns the original database; other
 * accounts get a runtime backed by their own database file, which is what
 * keeps every read and write scoped to the logged-in user.
 */
export interface KernelRuntime {
  user: string;
  config: AppConfig;
  logger: Logger;
  db: SqliteDatabase | null;
  bus: EventBus;
  store: EventLog;
  contexts: ContextStore;
  runs: WorkflowRunStore;
  artifacts: ArtifactStore;
  topics: TopicStore;
  briefs: BriefStore;
  jobs: JobStore;
  deliveries: DeliveryStore;
  userWorkflows: UserWorkflowStore;
  events: TimelineEventStore;
  settings: SettingsService;
  workflows: WorkflowRegistry;
  runner: WorkflowRunner;
  scheduler: Scheduler;
  commands: CommandRouter;
  statuses: StatusHub;
  messaging: MessagingProvider;
  tts: TextToSpeechProvider;
  stop(): void;
}

export function createRuntime(options: RuntimeOptions): KernelRuntime {
  const { user, config, env, logger, db, overrides } = options;
  const overridden = overrides.stores ?? {};
  const sqlite = (): SqliteDatabase => {
    if (!db) throw new Error("SQLite storage is not available (all stores were overridden)");
    return db;
  };

  const store = overridden.events ?? new EventStore(sqlite());
  const bus = new EventBus(store, logger.child("events"));

  const contexts = overridden.contexts ?? new ContextRepository(sqlite());
  contexts.ensure({ id: DEFAULT_CONTEXT_ID, name: DEFAULT_CONTEXT_NAME });
  const runs = overridden.runs ?? new WorkflowRunRepository(sqlite());
  const artifacts = overridden.artifacts ?? new ArtifactRepository(sqlite());
  const topics = overridden.topics ?? new TopicRepository(sqlite());
  const briefs = overridden.briefs ?? new BriefRepository(artifacts);
  const jobs = overridden.jobs ?? new JobRepository(sqlite());
  const kv = overridden.kv ?? new KeyValueRepository(sqlite());
  const deliveries = overridden.deliveries ?? new DeliveryRepository(sqlite());
  const userWorkflows = overridden.userWorkflows ?? new UserWorkflowRepository(sqlite());
  const timelineEvents = overridden.timelineEvents ?? new EventRepository(sqlite());

  // Settings live in this user's database; the boot-time config is the base
  // that overrides are layered onto.
  const settings = new SettingsService({ kv, env, config, bus });
  settings.applyAll();

  // One-time migration of the former MATRIX_* configuration into the first
  // delivery channel. Only the admin's database carries that legacy config.
  if (options.legacyMigrations) {
    migrateLegacyMatrixChannel(deliveries, env, kv, logger.child("delivery"));
  }

  const delivery =
    overrides.delivery ??
    new DeliveryService({
      store: deliveries,
      bus,
      logger: logger.child("delivery"),
    });

  const llmSessionId = config.llm.sessionId ?? crypto.randomUUID();

  const buildLlm = (): LlmProvider =>
    new OpenAiCompatibleLlmProvider({
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
      defaultModel: config.llm.model,
      name: "openai-compatible",
      sessionId: llmSessionId,
    });

  const buildWebSearch = (): SearchProvider =>
    new PerplexitySearchProvider({
      apiKey: config.perplexity.apiKey,
      baseUrl: config.perplexity.baseUrl,
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

  const buildExaSearch = (): SearchProvider =>
    new ExaSearchProvider({
      apiKey: config.exa.apiKey,
      baseUrl: config.exa.baseUrl,
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

  /** Every configured web provider; the researcher gets one tool each. */
  const buildSearchProviders = (): SearchProvider[] => {
    const providers: SearchProvider[] = [];
    if (overrides.webSearch) providers.push(overrides.webSearch);
    else if (config.perplexity.apiKey) providers.push(buildWebSearch());
    if (overrides.exaSearch) providers.push(overrides.exaSearch);
    else if (config.exa.apiKey) providers.push(buildExaSearch());
    return providers;
  };
  let searchProviders = buildSearchProviders();

  const buildSocialSearch = (): SearchProvider =>
    new BlueskySearchProvider({
      identifier: config.bluesky.identifier,
      appPassword: config.bluesky.appPassword,
      pdsUrl: config.bluesky.pdsUrl,
      publicUrl: config.bluesky.publicUrl,
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

  const buildFinance = (): FinanceProvider =>
    new PerplexityFinanceProvider({
      apiKey: config.perplexity.apiKey,
      baseUrl: config.perplexity.baseUrl,
      model: config.perplexity.financeModel,
    });

  // Both speech providers implement the same TTS protocol; the user's
  // TTS_PROVIDER setting picks which one runs.
  const buildTts = (): TextToSpeechProvider =>
    config.tts.provider === "elevenlabs"
      ? new ElevenLabsTtsProvider({
          apiKey: config.elevenlabs.apiKey,
          baseUrl: config.elevenlabs.baseUrl,
          modelId: config.elevenlabs.modelId,
          voiceId: config.elevenlabs.voiceId,
          outputFormat: config.elevenlabs.outputFormat,
          speed: config.elevenlabs.speed,
          maxCharsPerRequest: config.elevenlabs.maxCharsPerRequest,
        })
      : new QwenTtsProvider({
          baseUrl: config.qwenTts.baseUrl,
          model: config.qwenTts.model,
          voiceId: config.qwenTts.voiceId,
          outputFormat: config.qwenTts.outputFormat,
          requestFormat: config.qwenTts.requestFormat,
          language: config.qwenTts.language,
          speed: config.qwenTts.speed,
          apiKey: config.qwenTts.apiKey,
          timeoutMs: config.qwenTts.timeoutMs,
        });

  // Matrix consumers (delivery senders, startup check, chat listener) are all
  // driven by the first enabled matrix delivery channel now.
  const firstMatrixChannel = (): DeliveryChannel | undefined =>
    deliveries.channels().find((channel) => channel.type === "matrix" && channel.enabled);

  /** Connection fields shared by the Matrix client, messaging and chat listener. */
  const matrixConnection = (): MatrixChannelConfig | undefined =>
    matrixChannelConfig(firstMatrixChannel()?.config);

  const buildMatrixClient = (): MatrixClient => new MatrixClient(matrixConnection() ?? {});

  let matrixClient = buildMatrixClient();

  const buildMessaging = (): MessagingProvider =>
    new MatrixMessagingProvider({
      ...(matrixConnection() ?? {}),
      client: matrixClient,
    });

  const bag = {
    llm: overrides.llm ?? buildLlm(),
    webSearch: overrides.webSearch ?? buildWebSearch(),
    socialSearch: overrides.socialSearch ?? buildSocialSearch(),
    finance: overrides.finance ?? buildFinance(),
    tts: overrides.tts ?? buildTts(),
    messaging: overrides.messaging ?? buildMessaging(),
  };

  const statusRepository = overridden.statuses ?? (db ? new StatusRepository(sqlite()) : undefined);
  const statuses = new StatusHub({
    ...(statusRepository ? { store: statusRepository } : {}),
  });
  new StatusService({ bus, logger: logger.child("status"), hub: statuses });

  // Bring back the persisted activity feed (its running entries become
  // interrupted); still-running runs are resumed from their checkpoints once
  // the runner exists.
  if (statusRepository) statuses.restore(statusRepository.load());

  const workflows = new WorkflowRegistry({ bus, logger: logger.child("workflows"), statuses });

  // Read through to the live config so setting changes reach running workflows.
  const researchDefaults = {
    get recency() {
      return config.defaults.searchRecency;
    },
    get resultsPerProvider() {
      return config.defaults.searchResultsPerProvider;
    },
    get searchDomains() {
      return config.defaults.searchDomains;
    },
    get language() {
      return config.defaults.briefLanguage;
    },
    get eventTagModel() {
      return config.defaults.eventTagModel;
    },
  };

  // Local decision model for event tagging; unavailable models fall back
  // to the LLM categorizer, so registering it is always safe.
  const decisions = new DecisionModelRegistry();
  if (config.laya.enabled) {
    decisions.register(
      new LayaOnnxDecisionModel({ modelDir: config.laya.modelDir, allowDownload: true }),
    );
  }

  const briefing = new BriefingWorkflow({
    topics,
    briefs,
    artifacts,
    events: timelineEvents,
    statuses,
    defaults: researchDefaults,
    get llm() {
      return bag.llm;
    },
    get webSearch() {
      return bag.webSearch;
    },
    get searchProviders() {
      return searchProviders;
    },
    get socialSearch() {
      return bag.socialSearch;
    },
    get finance() {
      return bag.finance;
    },
    get tts() {
      return bag.tts;
    },
    delivery,
    appUrl: config.appUrl,
    decisions,
    decisionConfidence: config.laya.confidenceThreshold,
  });
  workflows.register(briefing);

  const question = new QuestionWorkflow({
    briefs,
    statuses,
    defaults: researchDefaults,
    get llm() {
      return bag.llm;
    },
    get webSearch() {
      return bag.webSearch;
    },
    get socialSearch() {
      return bag.socialSearch;
    },
  });
  workflows.register(question);

  // Core workflows can be customized through a user workflow row under their
  // own id (the sync below replaces the registration); this map restores the
  // built-in implementation when the customization is removed.
  const coreWorkflows = new Map<string, Workflow>([
    [briefing.definition.id, briefing],
    [question.definition.id, question],
  ]);

  // User workflow instances are runnable workflows too: register them before
  // the runner exists so boot-time resumeInterrupted can find their runs.
  const syncUserWorkflows = createUserWorkflowSync(workflows, briefing, userWorkflows, coreWorkflows);
  syncUserWorkflows();
  bus.subscribe("workflow.user.changed", () => {
    try {
      syncUserWorkflows();
    } catch (error) {
      logger.error("syncing user workflows failed", { error: errorMessage(error) });
    }
  });

  // Delivery moved from whole workflows onto step outputs; expand attachments
  // from before the upgrade onto every deliverable output of their workflow.
  normalizeLegacyAttachments(deliveries, workflows, logger.child("delivery"));

  const runner = new WorkflowRunner({
    workflows,
    runs,
    bus,
    logger: logger.child("runs"),
    statuses,
  });
  void runner
    .resumeInterrupted()
    .then((resumed) => {
      if (resumed > 0) logger.info("resumed interrupted runs", { runs: resumed });
    })
    .catch((error) => {
      logger.error("resuming interrupted runs failed", { error: errorMessage(error) });
    });
  const triggers = new TriggerDispatcher({
    workflows,
    runner,
    logger: logger.child("triggers"),
  });

  const scheduler = new Scheduler({
    jobs,
    runner,
    bus,
    logger: logger.child("scheduler"),
    defaultTimezone: config.timezone,
  });

  seedDefaultJobIfEmpty(jobs, config, logger);
  scheduler.reload();

  const commands = new CommandRouter({ bus, logger: logger.child("commands") });
  registerCommands(commands, {
    config,
    bus,
    logger: logger.child("commands"),
    contexts,
    runs,
    runner,
    artifacts,
    topics,
    briefs,
    jobs,
    events: timelineEvents,
    workflows,
    coreWorkflows,
    scheduler,
    statuses,
    settings,
    delivery,
    deliveries,
    userWorkflows,
    get tts() {
      return bag.tts;
    },
  });

  const createChatListener = (client: MatrixClient): MatrixCommandListener | null => {
    const matrix = matrixConnection();
    if (!matrix?.roomId) return null;

    return new MatrixCommandListener({
      client,
      kv,
      bus,
      logger: logger.child("matrix-chat"),
      roomId: matrix.roomId,
      allowedSenders: matrix.allowedSenders,
      onCommand: createChatCommandHandler({
        config,
        jobs,
        workflows,
        runner,
        scheduler,
        bus,
        get messaging() {
          return bag.messaging;
        },
        logger: logger.child("chat"),
      }),
      onMessage: async (input) => {
        const triggered = await triggers.dispatch("matrix", {
          input: { question: input.body, chain: input.chain },
          detail: {
            channel: input.channel,
            eventId: input.eventId,
            sender: input.sender,
            replyToBot: input.replyToBot,
            ...(input.quotedEventId ? { quotedEventId: input.quotedEventId } : {}),
          },
        });

        const answered = triggered.find((run) => {
          const output = run.output as { answer?: unknown } | undefined;
          return typeof output?.answer === "string" && output.answer.length > 0;
        });
        if (answered) {
          return { answer: (answered.output as { answer: string }).answer };
        }

        const failed = triggered.find((run) => run.status === "failed");
        if (failed) throw new Error(failed.error ?? "workflow failed");
        return undefined;
      },
    });
  };

  let chatListener = createChatListener(matrixClient);

  // A settings change rebuilds the providers; overridden providers stay put
  // (tests and embedders own their instances).
  const refreshProviders = (): void => {
    if (!overrides.llm) bag.llm = buildLlm();
    if (!overrides.webSearch) bag.webSearch = buildWebSearch();
    searchProviders = buildSearchProviders();
    if (!overrides.socialSearch) bag.socialSearch = buildSocialSearch();
    if (!overrides.finance) bag.finance = buildFinance();
    if (!overrides.tts) bag.tts = buildTts();
    if (!overrides.messaging) {
      matrixClient = buildMatrixClient();
      bag.messaging = buildMessaging();
      chatListener?.stop();
      chatListener = createChatListener(matrixClient);
      void chatListener?.start().catch((error) => {
        logger.error("command listener failed to start", { error: errorMessage(error) });
      });
    }
  };
  settings.onReload = refreshProviders;

  if (chatListener) {
    void chatListener.start().catch((error) => {
      logger.error("command listener failed to start", { error: errorMessage(error) });
    });
  }

  if (options.runStartup && config.startup.enabled) {
    const matrix = matrixChannelConfig(firstMatrixChannel()?.config);
    const startup = new StartupService({
      config,
      bus,
      logger: logger.child("startup"),
      llm: bag.llm,
      webSearch: bag.webSearch,
      socialSearch: bag.socialSearch,
      tts: bag.tts,
      messaging: bag.messaging,
      matrix: matrix ?? null,
      jobs: scheduler.registeredCount,
      workflows: workflows.list().map((workflow) => workflow.id),
    });

    void startup.run().catch((error) => {
      logger.error("startup validation crashed", { error: errorMessage(error) });
    });
  }

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    bus.publish("system.stopping", { reason: "shutdown" }, { source: `runtime:${user}` });
    chatListener?.stop();
    scheduler.stop();
    if (options.ownsDb) db?.close();
  };

  return {
    user,
    config,
    logger,
    db,
    bus,
    store,
    contexts,
    runs,
    artifacts,
    topics,
    briefs,
    jobs,
    deliveries,
    userWorkflows,
    events: timelineEvents,
    settings,
    workflows,
    runner,
    scheduler,
    commands,
    statuses,
    get messaging() {
      return bag.messaging;
    },
    get tts() {
      return bag.tts;
    },
    stop,
  };
}

function seedDefaultJobIfEmpty(jobs: JobStore, config: AppConfig, logger: Logger): void {
  if (jobs.count() > 0) return;

  const job = jobs.create({
    name: "morning-brief",
    cron: config.defaults.briefCron,
    timezone: config.timezone,
    workflow: "briefing",
    contextId: DEFAULT_CONTEXT_ID,
    input: {},
    enabled: true,
  });

  logger.info("seeded default scheduled job", { id: job.id, cron: job.cron });
}

/**
 * Boot migration helper for the workflow-level → step-output delivery move:
 * attachments with an empty step/output apply to every deliverable output of
 * the workflow's definition. Rows of workflows that no longer exist (or have
 * no deliverable outputs) are dropped.
 */
function normalizeLegacyAttachments(
  deliveries: DeliveryStore,
  workflows: WorkflowRegistry,
  logger: Logger,
): void {
  // Workflow-level rows from before step outputs: expand onto every target.
  const legacy = deliveries
    .attachments()
    .filter((attachment) => attachment.step === "" && attachment.output === "");
  for (const row of legacy) {
    deliveries.detach({ workflow: row.workflow, step: "", output: "" }, row.channelId);

    let targets: ReturnType<typeof deliveryTargets> = [];
    try {
      targets = deliveryTargets(workflows.get(row.workflow).definition);
    } catch {
      targets = [];
    }
    for (const target of targets) {
      deliveries.attach(
        { workflow: row.workflow, step: target.step, output: target.output },
        row.channelId,
      );
    }
  }
  if (legacy.length > 0) {
    logger.info("expanded workflow delivery attachments onto step outputs", {
      attachments: legacy.length,
    });
  }

  // Targets that no longer exist (e.g. a renamed output type) move to the
  // step's deliverable output when that is unambiguous.
  const stale = deliveries
    .attachments()
    .filter((attachment) => attachment.step !== "" && attachment.output !== "");
  for (const row of stale) {
    let step: ReturnType<typeof findStep> = undefined;
    try {
      step = findStep(workflows.get(row.workflow).definition, row.step);
    } catch {
      step = undefined;
    }
    if (step?.outputs.some((output) => output.kind === row.output && output.deliver)) continue;

    deliveries.detach({ workflow: row.workflow, step: row.step, output: row.output }, row.channelId);
    const deliverable = step?.outputs.filter((output) => output.deliver) ?? [];
    if (deliverable.length === 1) {
      deliveries.attach(
        { workflow: row.workflow, step: row.step, output: deliverable[0]!.kind },
        row.channelId,
      );
      logger.info("moved a stale delivery assignment to the step's output", {
        workflow: row.workflow,
        step: row.step,
        from: row.output,
        to: deliverable[0]!.kind,
      });
    } else if (deliverable.length > 1) {
      logger.warn("dropped a stale delivery assignment with no clear target", {
        workflow: row.workflow,
        step: row.step,
        output: row.output,
      });
    }
  }
}

/**
 * Boot migration: moves the removed MATRIX_* configuration (environment
 * values win over stored setting overrides, as before) into the first
 * matrix delivery channel. Runs only while no delivery channel exists; the
 * legacy setting overrides are consumed (deleted) either way.
 */
function migrateLegacyMatrixChannel(
  deliveries: DeliveryStore,
  env: Env,
  kv: KeyValueStore,
  logger: Logger,
): void {
  const read = (key: string): string | undefined => {
    const fromEnv = env[key];
    if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
    return kv.get(`setting:${key}`) ?? undefined;
  };

  const homeserverUrl = read("MATRIX_HOMESERVER_URL");
  const roomId = read("MATRIX_ROOM_ID");
  const accessToken = read("MATRIX_ACCESS_TOKEN");
  const username = read("MATRIX_USERNAME");
  const password = read("MATRIX_PASSWORD");
  // Stored the way the delivery UI form writes it (comma-separated string).
  const allowedSenders = read("MATRIX_ALLOWED_SENDERS")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(", ");

  // The Matrix settings no longer exist; remove stale database overrides.
  for (const key of LEGACY_MATRIX_KEYS) kv.delete(`setting:${key}`);

  if (deliveries.countChannels() > 0) return;
  if (!homeserverUrl || !roomId || !(accessToken || (username && password))) {
    logger.info("no legacy Matrix configuration found; nothing was migrated");
    return;
  }

  const channel = deliveries.createChannel({
    type: "matrix",
    name: "Matrix",
    config: {
      homeserverUrl,
      roomId,
      ...(accessToken ? { accessToken } : {}),
      ...(username ? { username } : {}),
      ...(password ? { password } : {}),
      ...(allowedSenders ? { allowedSenders } : {}),
    },
  });
  logger.info("migrated legacy Matrix configuration into a delivery channel", {
    channelId: channel.id,
  });
}
