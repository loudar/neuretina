import { loadConfig, type AppConfig } from "../config/env.ts";
import { createLogger, type Logger } from "../core/logger.ts";
import { errorMessage } from "../core/errors.ts";
import { EventBus } from "../core/events/EventBus.ts";
import { EventStore } from "../core/events/EventStore.ts";
import { CommandRouter } from "../core/commands/CommandRouter.ts";
import { Scheduler } from "../core/scheduler/Scheduler.ts";
import { WorkflowRegistry } from "../core/workflow/Workflow.ts";
import { SqliteDatabase } from "../infra/db/SqliteDatabase.ts";
import { BriefRepository } from "../domain/briefs/BriefRepository.ts";
import { JobRepository } from "../domain/jobs/JobRepository.ts";
import { TopicRepository } from "../domain/topics/TopicRepository.ts";
import { BriefingWorkflow } from "../workflows/BriefingWorkflow.ts";
import { registerCommands } from "../commands/registerCommands.ts";
import { StartupService } from "../startup/StartupService.ts";
import { KeyValueRepository } from "../domain/kv/KeyValueRepository.ts";
import { MatrixClient } from "../providers/messaging/MatrixClient.ts";
import { MatrixCommandListener } from "../providers/messaging/MatrixCommandListener.ts";
import { createChatCommandHandler } from "../chat/ChatCommands.ts";
import { OpenAiCompatibleLlmProvider } from "../providers/llm/OpenAiCompatibleLlmProvider.ts";
import { PerplexitySearchProvider } from "../providers/search/PerplexitySearchProvider.ts";
import { BlueskySearchProvider } from "../providers/search/BlueskySearchProvider.ts";
import { ElevenLabsTtsProvider } from "../providers/tts/ElevenLabsTtsProvider.ts";
import { MatrixMessagingProvider } from "../providers/messaging/MatrixMessagingProvider.ts";
import type { LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import type { SearchProvider } from "../capabilities/search/SearchProvider.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import { createApiServer, type ApiServer } from "../api/server.ts";

export interface KernelOverrides {
  config?: AppConfig;
  logger?: Logger;
  llm?: LlmProvider;
  webSearch?: SearchProvider;
  socialSearch?: SearchProvider;
  tts?: TextToSpeechProvider;
  messaging?: MessagingProvider;
}

export interface Kernel {
  config: AppConfig;
  logger: Logger;
  db: SqliteDatabase;
  bus: EventBus;
  store: EventStore;
  topics: TopicRepository;
  briefs: BriefRepository;
  jobs: JobRepository;
  workflows: WorkflowRegistry;
  scheduler: Scheduler;
  commands: CommandRouter;
  api: ApiServer;
  shutdown(): Promise<void>;
}

export async function createKernel(overrides: KernelOverrides = {}): Promise<Kernel> {
  const config = overrides.config ?? loadConfig();
  const logger = overrides.logger ?? createLogger("kernel", { level: config.logLevel });

  const db = new SqliteDatabase(config.dbPath);
  const store = new EventStore(db);
  const bus = new EventBus(store, logger.child("events"));

  const topics = new TopicRepository(db);
  const briefs = new BriefRepository(db);
  const jobs = new JobRepository(db);

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

  const tts =
    overrides.tts ??
    new ElevenLabsTtsProvider({
      apiKey: config.elevenlabs.apiKey,
      baseUrl: config.elevenlabs.baseUrl,
      modelId: config.elevenlabs.modelId,
      voiceId: config.elevenlabs.voiceId,
      outputFormat: config.elevenlabs.outputFormat,
      maxCharsPerRequest: config.elevenlabs.maxCharsPerRequest,
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

  const workflows = new WorkflowRegistry({ bus, logger: logger.child("workflows") });
  workflows.register(
    new BriefingWorkflow({
      topics,
      briefs,
      llm,
      webSearch,
      socialSearch,
      tts,
      messaging,
      defaults: {
        recency: config.defaults.searchRecency,
        resultsPerProvider: config.defaults.searchResultsPerProvider,
        language: config.defaults.briefLanguage,
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
  registerCommands(commands, { config, bus, topics, briefs, jobs, workflows, scheduler });

  const kv = new KeyValueRepository(db);
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
    });
  }

  const api = createApiServer({
    config,
    bus,
    commands,
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
      webSearch,
      socialSearch,
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
    db.close();
  };

  return {
    config,
    logger,
    db,
    bus,
    store,
    topics,
    briefs,
    jobs,
    workflows,
    scheduler,
    commands,
    api,
    shutdown,
  };
}

function seedDefaultJobIfEmpty(jobs: JobRepository, config: AppConfig, logger: Logger): void {
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
