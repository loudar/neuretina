import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import { errorMessage, ProviderError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import { StartupValidator } from "../core/startup/StartupValidator.ts";
import type { CheckOutcome, StartupCheck, StartupReport } from "../core/startup/StartupValidator.ts";
import { requestJson } from "../infra/http/request.ts";
import { APP_USER_AGENT } from "../version.ts";
import type { SearchProvider } from "../capabilities/search/SearchProvider.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import { isVerifiable } from "../capabilities/messaging/MessagingProvider.ts";

export interface StartupServiceDeps {
  config: AppConfig;
  bus: EventBus;
  logger: Logger;
  webSearch: SearchProvider;
  socialSearch: SearchProvider;
  messaging: MessagingProvider;
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
    const { config, webSearch, socialSearch, messaging } = this.deps;

    return [
      {
        name: "llm",
        run: async (): Promise<CheckOutcome> => {
          if (!config.llm.apiKey) {
            return { status: "skipped", detail: "OPENCODE_API_KEY not set" };
          }
          const url = `${stripTrailingSlash(config.llm.baseUrl)}/models`;
          const response = await requestJson<{ data?: unknown[] }>("startup", url, {
            headers: {
              Authorization: `Bearer ${config.llm.apiKey}`,
              "x-opencode-session": config.llm.sessionId ?? "briefing-engine-startup",
              "user-agent": APP_USER_AGENT,
            },
          });
          const models = Array.isArray(response.data) ? response.data.length : undefined;
          return {
            status: "ok",
            detail: models !== undefined ? `reachable, ${models} models` : "reachable",
          };
        },
      },
      {
        name: "perplexity",
        run: async (): Promise<CheckOutcome> => {
          if (!config.perplexity.apiKey) {
            return { status: "skipped", detail: "KEY_PERPLEXITY not set" };
          }
          const response = await requestJson<{ results?: unknown[] }>(
            "startup",
            `${stripTrailingSlash(config.perplexity.baseUrl)}/search`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${config.perplexity.apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                query: "briefing engine startup check",
                max_results: 1,
                search_type: "fast",
              }),
            },
          );
          return { status: "ok", detail: `reachable, ${response.results?.length ?? 0} result(s)` };
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
        name: "elevenlabs",
        run: async (): Promise<CheckOutcome> => {
          if (!config.elevenlabs.apiKey) {
            return { status: "skipped", detail: "KEY_ELEVENLABS not set" };
          }
          const voiceId = encodeURIComponent(config.elevenlabs.voiceId);
          try {
            const voice = await requestJson<{ name?: string }>(
              "startup",
              `${stripTrailingSlash(config.elevenlabs.baseUrl)}/v1/voices/${voiceId}`,
              { headers: { "xi-api-key": config.elevenlabs.apiKey } },
            );
            return { status: "ok", detail: `voice "${voice.name ?? config.elevenlabs.voiceId}" available` };
          } catch (error) {
            if (error instanceof ProviderError && error.status === 404) {
              return {
                status: "failed",
                detail: `voice "${config.elevenlabs.voiceId}" not found (check ELEVENLABS_VOICE_ID)`,
              };
            }
            throw error;
          }
        },
      },
      {
        name: "web-search",
        run: async (): Promise<CheckOutcome> => {
          if (!config.perplexity.apiKey) {
            return { status: "skipped", detail: "search provider not configured" };
          }
          const response = await webSearch.search({ query: "briefing engine startup check", limit: 1 });
          return { status: "ok", detail: `${response.provider} returned ${response.results.length} result(s)` };
        },
      },
      {
        name: "matrix",
        run: async (): Promise<CheckOutcome> => {
          if (!configStatus(config).matrix) {
            return { status: "skipped", detail: "Matrix not configured" };
          }
          if (isVerifiable(messaging)) {
            return { status: "ok", detail: await messaging.verify() };
          }
          return { status: "ok", detail: "credentials and room configured" };
        },
      },
    ];
  }

  private async announce(
    report: StartupReport,
  ): Promise<StartupServiceResult["announce"]> {
    const { config, bus, messaging } = this.deps;

    if (!config.startup.announce) {
      this.logger.info("startup announcement disabled (set STARTUP_ANNOUNCE=true to enable)");
      return { status: "skipped", detail: "STARTUP_ANNOUNCE is disabled" };
    }

    if (!configStatus(config).matrix) {
      this.logger.info("startup announcement skipped (Matrix not configured)");
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
    `Briefing Engine started – ${stamp} UTC (TZ ${meta.timezone})`,
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

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
