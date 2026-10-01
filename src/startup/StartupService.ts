import type { AppConfig } from "../config/env.ts";
import {
  activeLlmConnection,
  isLlmConnectionConfigured,
} from "../capabilities/llm/LlmProviders.ts";
import { errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import { isVerifiable } from "../core/verifiable.ts";
import { StartupValidator } from "../core/startup/StartupValidator.ts";
import type { CheckOutcome, StartupCheck, StartupReport } from "../core/startup/StartupValidator.ts";
import type { LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import type { SearchProvider } from "../capabilities/search/SearchProvider.ts";
import type { TextToSpeechProvider } from "../capabilities/tts/TtsProvider.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";

export interface StartupServiceDeps {
  config: AppConfig;
  bus: EventBus;
  logger: Logger;
  llm: LlmProvider;
  webSearch: SearchProvider;
  socialSearch: SearchProvider;
  tts: TextToSpeechProvider;
  messaging: MessagingProvider;
  /** Summary of the first enabled matrix delivery channel; absent = no Matrix. */
  matrix?: { roomId?: string } | null;
  jobs: number;
  workflows: string[];
}

export interface StartupServiceResult {
  report: StartupReport;
  announce: { status: "sent" | "skipped" | "failed"; detail: string };
}

/**
 * Validates every configured integration after boot and announces the result
 * to the default messaging channel (Matrix room).
 */
export class StartupService {
  private readonly logger: Logger;

  constructor(private readonly deps: StartupServiceDeps) {
    this.logger = deps.logger.child("startup");
  }

  async run(): Promise<StartupServiceResult> {
    const validator = new StartupValidator({
      bus: this.deps.bus,
      logger: this.logger,
      checks: this.buildChecks(),
    });

    const report = await validator.run();
    const announce = await this.announce(report);

    return { report, announce };
  }

  private buildChecks(): StartupCheck[] {
    const { config, llm, webSearch, socialSearch, tts, messaging, matrix } = this.deps;

    return [
      {
        name: "llm",
        run: async (): Promise<CheckOutcome> => {
          const connection = activeLlmConnection(config.llmProviders, config.llmProvider);
          if (!isLlmConnectionConfigured(connection)) {
            return { status: "skipped", detail: "no LLM provider configured" };
          }
          if (isVerifiable(llm)) return { status: "ok", detail: await llm.verify() };
          return { status: "ok", detail: "configured" };
        },
      },
      {
        name: "web-search",
        run: async (): Promise<CheckOutcome> => {
          if (!Array.isArray(config.searchProviders) || config.searchProviders.length === 0) {
            return { status: "skipped", detail: "no web search provider configured" };
          }
          if (isVerifiable(webSearch)) return { status: "ok", detail: await webSearch.verify() };
          const response = await webSearch.search({ query: "neuretina startup check", limit: 1 });
          return {
            status: "ok",
            detail: `${response.provider} returned ${response.results.length} result(s)`,
          };
        },
      },
      {
        name: "bluesky",
        run: async (): Promise<CheckOutcome> => {
          if (!config.bluesky.identifier || !config.bluesky.appPassword) {
            return {
              status: "skipped",
              detail: "public mode (set BLUESKY_IDENTIFIER + BLUESKY_APP_PASSWORD for reliable search)",
            };
          }
          const response = await socialSearch.search({ query: "atproto", limit: 1, recency: "week" });
          return { status: "ok", detail: `authenticated, ${response.results.length} post(s)` };
        },
      },
      {
        name: "tts",
        run: async (): Promise<CheckOutcome> => {
          if (!config.qwenTts.baseUrl) {
            return { status: "skipped", detail: "QWEN_TTS_BASE_URL not set" };
          }
          if (isVerifiable(tts)) return { status: "ok", detail: await tts.verify() };
          return { status: "ok", detail: "configured" };
        },
      },
      {
        name: "matrix",
        run: async (): Promise<CheckOutcome> => {
          if (!matrix) {
            return { status: "skipped", detail: "no matrix delivery channel" };
          }
          if (isVerifiable(messaging)) {
            return { status: "ok", detail: await messaging.verify() };
          }
          return { status: "ok", detail: "channel configured" };
        },
      },
    ];
  }

  private async announce(
    report: StartupReport,
  ): Promise<StartupServiceResult["announce"]> {
    const { config, bus, messaging, matrix } = this.deps;

    if (!config.startup.announce) {
      this.logger.info("startup announcement disabled (set STARTUP_ANNOUNCE=true to enable)");
      return { status: "skipped", detail: "STARTUP_ANNOUNCE is disabled" };
    }

    if (!matrix) {
      this.logger.info("startup announcement skipped (no matrix delivery channel)");
      return { status: "skipped", detail: "Matrix not configured" };
    }

    const text = formatStartupReport(report, {
      jobs: this.deps.jobs,
      workflows: this.deps.workflows,
      timezone: config.timezone,
    });

    try {
      const sent = await messaging.send({ kind: "text", text });
      bus.publish(
        "system.startup.announced",
        { channel: sent.channel, eventId: sent.id },
        { source: "startup" },
      );
      this.logger.info("startup message sent", { channel: sent.channel, eventId: sent.id });
      return { status: "sent", detail: `${sent.channel} (${sent.id})` };
    } catch (error) {
      const message = errorMessage(error);
      bus.publish("system.startup.announce_failed", { error: message }, { source: "startup" });
      this.logger.error("startup message failed", { error: message });
      return { status: "failed", detail: message };
    }
  }
}

export interface StartupReportMeta {
  jobs: number;
  workflows: string[];
  timezone: string;
}

export function formatStartupReport(report: StartupReport, meta: StartupReportMeta): string {
  const stamp = new Date(report.startedAt).toISOString().replace("T", " ").slice(0, 16);
  const lines: string[] = [
    `Neuretina started – ${stamp} UTC (TZ ${meta.timezone})`,
    "",
  ];

  for (const result of report.results) {
    lines.push(`[${result.status}] ${result.name}: ${result.detail}`);
  }

  const failed = report.results.filter((result) => result.status === "failed");
  lines.push("");
  lines.push(`Scheduled jobs: ${meta.jobs} · Workflows: ${meta.workflows.join(", ") || "none"}`);
  lines.push(
    failed.length === 0
      ? "Startup validation: all checks passed."
      : `Startup validation: ${failed.length} check(s) failed (${failed.map((result) => result.name).join(", ")}).`,
  );

  return lines.join("\n");
}
