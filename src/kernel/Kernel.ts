import { loadConfig, type AppConfig } from "../config/env.ts";
import { createLogger, type Logger } from "../core/logger.ts";
import { errorMessage } from "../core/errors.ts";
import { EventBus } from "../core/events/EventBus.ts";
import { EventStore, type EventLog } from "../core/events/EventStore.ts";
import { CommandRouter } from "../core/commands/CommandRouter.ts";
import { StatusHub } from "../core/status/StatusHub.ts";
import { StatusService } from "../status/StatusService.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import { WorkflowRegistry } from "../core/workflow/Workflow.ts";
import { SqliteDatabase } from "../infra/db/SqliteDatabase.ts";
import { ArtifactRepository, type ArtifactStore } from "../domain/artifacts/ArtifactRepository.ts";
import { BriefRepository, type BriefStore } from "../domain/briefs/BriefRepository.ts";
import { JobRepository, type JobStore } from "../domain/jobs/JobRepository.ts";
import { TopicRepository, type TopicStore } from "../domain/topics/TopicRepository.ts";
import { BriefingWorkflow } from "../workflows/BriefingWorkflow.ts";
import { registerCommands } from "../commands/registerCommands.ts";
import { StartupService } from "../startup/StartupService.ts";
import { QuestionAnswerer } from "../qa/QuestionAnswerer.ts";
import { KeyValueRepository, type KeyValueStore } from "../domain/kv/KeyValueRepository.ts";
import { MatrixClient } from "../providers/messaging/MatrixClient.ts";
import { MatrixCommandListener } from "../providers/messaging/MatrixCommandListener.ts";
import { createChatCommandHandler } from "../chat/ChatCommands.ts";
import { OpenAiCompatibleLlmProvider } from "../providers/llm/OpenAiCompatibleLlmProvider.ts";
import { PerplexitySearchProvider } from "../providers/search/PerplexitySearchProvider.ts";
import { PerplexityFinanceProvider } from "../providers/finance/PerplexityFinanceProvider.ts";
import { BlueskySearchProvider } from "../providers/search/BlueskySearchProvider.ts";
import { QwenTtsProvider } from "../providers/tts/QwenTtsProvider.ts";
import { MatrixMessagingProvider } from "../providers/messaging/MatrixMessagingProvider.ts";
import type { LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import type { SearchProvider } from "../capabilities/search/SearchProvider.ts";
import type { FinanceProvider } from "../capabilities/finance/FinanceProvider.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import { createApiServer, type ApiServer } from "../api/server.ts";

/** Swap any piece of storage; missing pieces fall back to the SQLite stores. */
export interface KernelStores {
  events?: EventLog;
  artifacts?: ArtifactStore;
  topics?: TopicStore;
  briefs?: BriefStore;
  jobs?: JobStore;
  kv?: KeyValueStore;
}

export interface KernelOverrides {
  config?: AppConfig;
  logger?: Logger;
  /** Storage implementation; the composition root is the only place that picks one. */
  stores?: KernelStores;
  llm?: LlmProvider;
  webSearch?: SearchProvider;
  socialSearch?: SearchProvider;
  finance?: FinanceProvider;
  tts?: TextToSpeechProvider;
  messaging?: MessagingProvider;
}

export interface Kernel {
  config: AppConfig;
  logger: Logger;
  /** The SQLite handle, or null when every store was overridden. */
  db: SqliteDatabase | null;
  bus: EventBus;
  store: EventLog;
  artifacts: ArtifactStore;
  topics: TopicStore;
  briefs: BriefStore;
  jobs: JobStore;
  workflows: WorkflowRegistry;
  scheduler: Scheduler;
  commands: CommandRouter;
  statuses: StatusHub;
  messaging: MessagingProvider;
  tts: TextToSpeechProvider;
  api: ApiServer;
  shutdown(): Promise<void>;
}

export async function createKernel(overrides: KernelOverrides = {}): Promise<Kernel> {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger("kernel", { level: config.logLevel });

  const overridden = overrides.stores ?? {};
  const needsSqlite =
    !overridden.events ||
    !overridden.artifacts ||
    !overridden.topics ||
    !overridden.briefs ||
    !overridden.jobs ||
    !overridden.kv;
  const db = needsSqlite ? new SqliteDatabase(config.dbPath) : null;
  const sqlite = (): SqliteDatabase => {
    if (!db) throw new Error("SQLite storage is not available (all stores were overridden)");
    return db;
  };

  const store = overridden.events ?? new EventStore(sqlite());
  const bus = new EventBus(store, logger.child("events"));

  const artifacts = overridden.artifacts ?? new ArtifactRepository(sqlite());
  const topics = overridden.topics ?? new TopicRepository(sqlite());
  const briefs = overridden.briefs ?? new BriefRepository(artifacts);
  const jobs = overridden.jobs ?? new JobRepository(sqlite());

  const llm =
    overrides.llm ??
    new OpenAiCompatibleLlmProvider({
      apiKey: config.llm.apiKey,
      baseUrl: config.llm.baseUrl,
      defaultModel: config.llm.model,
      name: "opencode-go",
      sessionId: config.llm.sessionId,
    });

  const webSearch =
    overrides.webSearch ??
    new PerplexitySearchProvider({
      apiKey: config.perplexity.apiKey,
      baseUrl: config.perplexity.baseUrl,
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

  const socialSearch =
    overrides.socialSearch ??
    new BlueskySearchProvider({
      identifier: config.bluesky.identifier,
      appPassword: config.bluesky.appPassword,
      pdsUrl: config.bluesky.pdsUrl,
      publicUrl: config.bluesky.publicUrl,
      defaultLimit: config.defaults.searchResultsPerProvider,
    });

  const finance =
    overrides.finance ??
    new PerplexityFinanceProvider({
      apiKey: config.perplexity.apiKey,
      baseUrl: config.perplexity.baseUrl,
      model: config.perplexity.financeModel,
    });

  const tts =
    overrides.tts ??
    new QwenTtsProvider({
      baseUrl: config.qwenTts.baseUrl,
      model: config.qwenTts.model,
      voiceId: config.qwenTts.voiceId,
      outputFormat: config.qwenTts.outputFormat,
      language: config.qwenTts.language,
      speed: config.qwenTts.speed,
      apiKey: config.qwenTts.apiKey,
    });

  const matrixClient = new MatrixClient({
    homeserverUrl: config.matrix.homeserverUrl,
    accessToken: config.matrix.accessToken,
    username: config.matrix.username,
    password: config.matrix.password,
  });

  const messaging =
    overrides.messaging ??
    new MatrixMessagingProvider({
      homeserverUrl: config.matrix.homeserverUrl,
      accessToken: config.matrix.accessToken,
      username: config.matrix.username,
      password: config.matrix.password,
      roomId: config.matrix.roomId,
      client: matrixClient,
    });

  const statuses = new StatusHub();
  new StatusService({ bus, logger: logger.child("status"), hub: statuses });

  const workflows = new WorkflowRegistry({ bus, logger: logger.child("workflows"), statuses });

  workflows.register(
    new BriefingWorkflow({
      topics,
      briefs,
      llm,
      webSearch,
      socialSearch,
      finance,
      tts,
      messaging,
      statuses,
      defaults: {
        recency: config.defaults.searchRecency,
        resultsPerProvider: config.defaults.searchResultsPerProvider,
        searchDomains: config.defaults.searchDomains,
        language: config.defaults.briefLanguage,
        followups: config.defaults.followups,
      },
    }),
  );

  const scheduler = new Scheduler({
    jobs,
    workflows,
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
    artifacts,
    topics,
    briefs,
    jobs,
    workflows,
    scheduler,
    messaging,
    tts,
    statuses,
  });

  const kv = overridden.kv ?? new KeyValueRepository(sqlite());
  const questionAnswerer = new QuestionAnswerer({
    llm,
    webSearch,
    socialSearch,
    briefs,
    statuses,
    defaults: {
      recency: config.defaults.searchRecency,
      resultsPerProvider: config.defaults.searchResultsPerProvider,
      language: config.defaults.briefLanguage,
      searchDomains: config.defaults.searchDomains,
    },
  });

  let chatListener: MatrixCommandListener | null = null;
  if (config.matrix.chatCommands) {
    chatListener = new MatrixCommandListener({
      client: matrixClient,
      kv,
      bus,
      logger: logger.child("matrix-chat"),
      roomId: config.matrix.roomId,
      allowedSenders: config.matrix.allowedSenders,
      onCommand: createChatCommandHandler({
        config,
        jobs,
        workflows,
        scheduler,
        messaging,
        bus,
        logger: logger.child("chat"),
      }),
      onQuestion: (input) =>
        questionAnswerer.answer(input.question, {
          correlationId: crypto.randomUUID(),
          bus,
          logger: logger.child("qa"),
        }),
    });
  }

  const api = createApiServer({
    config,
    bus,
    commands,
    statuses,
    logger,
  });

  bus.publish(
    "system.ready",
    { port: api.port, jobs: scheduler.registeredCount, workflows: workflows.list().map((w) => w.id) },
    { source: "kernel" },
  );

  if (config.matrix.chatCommands && chatListener) {
    void chatListener.start().catch((error) => {
      logger.error("command listener failed to start", { error: errorMessage(error) });
    });
  }

  if (config.startup.enabled) {
    const startup = new StartupService({
      config,
      bus,
      logger: logger.child("startup"),
      llm,
      webSearch,
      socialSearch,
      tts,
      messaging,
      jobs: scheduler.registeredCount,
      workflows: workflows.list().map((workflow) => workflow.id),
    });

    void startup.run().catch((error) => {
      logger.error("startup validation crashed", { error: errorMessage(error) });
    });
  }

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    bus.publish("system.stopping", { reason: "shutdown" }, { source: "kernel" });
    chatListener?.stop();
    scheduler.stop();
    api.stop();
    db?.close();
  };

  return {
    config,
    logger,
    db,
    bus,
    store,
    artifacts,
    topics,
    briefs,
    jobs,
    workflows,
    scheduler,
    commands,
    statuses,
    messaging,
    tts,
    api,
    shutdown,
  };
}

function seedDefaultJobIfEmpty(jobs: JobStore, config: AppConfig, logger: Logger): void {
  if (jobs.count() > 0) return;

  const job = jobs.create({
    name: "morning-brief",
    cron: config.defaults.briefCron,
    timezone: config.timezone,
    workflow: "briefing",
    input: {},
    enabled: true,
  });

  logger.info("seeded default scheduled job", { id: job.id, cron: job.cron });
}
