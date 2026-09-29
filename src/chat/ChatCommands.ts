import type { AppConfig } from "../config/env.ts";
import { configStatus } from "../config/env.ts";
import type { ChatCommand } from "../capabilities/chat/ChatChannel.ts";
import type { MessagingProvider } from "../capabilities/messaging/MessagingProvider.ts";
import { errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { DomainEvent } from "../core/events/types.ts";
import type { Logger } from "../core/logger.ts";
import type { Scheduler } from "../core/scheduler/Scheduler.ts";
import type { WorkflowRegistry } from "../core/workflow/Workflow.ts";
import type { WorkflowRunner } from "../core/workflow/WorkflowRunner.ts";
import type { JobStore, ScheduledJob } from "../domain/jobs/JobRepository.ts";

export interface ChatCommandDeps {
  config: AppConfig;
  jobs: JobStore;
  workflows: WorkflowRegistry;
  runner: WorkflowRunner;
  scheduler: Scheduler;
  messaging: MessagingProvider;
  bus: EventBus;
  logger: Logger;
}

const COMPLETION_TIMEOUT_MS = 60 * 60 * 1000;

export function createChatCommandHandler(
  deps: ChatCommandDeps,
): (command: ChatCommand) => Promise<string> {
  const log = deps.logger.child("chat");

  return async (command: ChatCommand): Promise<string> => {
    switch (command.command) {
      case "start":
        return startTask(command.args);
      case "list":
        return listText();
      case "status":
        return statusText();
      case "help":
      case "menu":
        return helpText();
      default:
        return `Unknown command "/${command.command}".\n\n${helpText()}`;
    }
  };

  function startTask(args: string): string {
    if (!args) return `Usage: /start <task id or name>\n\n${listText()}`;

    const job = findJob(args);
    if (job) {
      const correlationId = crypto.randomUUID();
      watchCompletion(correlationId, [`job.finished`, `job.failed`], `Job "${job.name}"`);
      // Failures are recorded as job.failed events and reported by watchCompletion.
      void deps.scheduler.runNow(job, correlationId).catch(() => undefined);
      return `Started job "${job.name}" (${job.workflow}) now — I'll post again when it finishes.`;
    }

    const workflow = deps.workflows
      .list()
      .find((entry) => entry.id.toLowerCase() === args.toLowerCase());
    if (workflow) {
      const correlationId = crypto.randomUUID();
      watchCompletion(correlationId, [`workflow.finished`, `workflow.failed`], `Workflow "${workflow.id}"`);
      void deps.runner
        .start({
          workflow: workflow.id,
          trigger: "manual",
          input: {},
          detail: { source: "chat" },
          runId: correlationId,
        })
        .catch((error) => {
          log.warn("workflow run failed", { error: errorMessage(error) });
        });
      return `Started workflow "${workflow.id}" now — I'll post again when it finishes.`;
    }

    return `Nothing matches "${args}".\n\n${listText()}`;
  }

  function findJob(args: string): ScheduledJob | undefined {
    const jobs = deps.jobs.list();
    const needle = args.trim().toLowerCase();
    return (
      jobs.find((job) => job.id === args.trim()) ??
      jobs.find((job) => job.name.toLowerCase() === needle) ??
      jobs.find((job) => job.name.toLowerCase().includes(needle))
    );
  }

  function watchCompletion(
    correlationId: string,
    topics: string[],
    label: string,
  ): void {
    let unsubscribe: (() => void) | null = null;
    const timer = setTimeout(() => unsubscribe?.(), COMPLETION_TIMEOUT_MS);

    const settle = (message: string) => {
      unsubscribe?.();
      clearTimeout(timer);
      void deps.messaging
        .send({ kind: "text", text: message })
        .catch((error) => log.warn("completion message failed", { error: errorMessage(error) }));
    };

    unsubscribe = deps.bus.subscribeTopics(topics, (event: DomainEvent) => {
      if (event.correlationId !== correlationId) return;

      const payload = event.payload as { durationMs?: number; error?: string };
      switch (event.topic) {
        case "job.finished":
        case "workflow.finished":
          settle(`${label} finished successfully (${Math.round((payload.durationMs ?? 0) / 1000)}s).`);
          break;
        case "job.failed":
        case "workflow.failed":
          settle(`${label} failed: ${payload.error ?? "unknown error"}`);
          break;
      }
    });
  }

  function listText(): string {
    const jobs = deps.jobs.list();
    const workflows = deps.workflows.list();

    const lines: string[] = ["Scheduled tasks:"];
    if (jobs.length === 0) lines.push("- (none)");
    for (const job of jobs) {
      lines.push(
        `- "${job.name}" · ${job.workflow} · cron ${job.cron} · ${job.enabled ? "enabled" : "disabled"} · id ${job.id.slice(0, 8)}`,
      );
    }
    lines.push("", `Workflows: ${workflows.map((workflow) => workflow.id).join(", ") || "none"}`);
    lines.push("", "Use /start <task id or name> to run one now.");
    return lines.join("\n");
  }

  function statusText(): string {
    const status = configStatus(deps.config);
    const lines = [
      "[ok] llm" + (status.llm ? "" : " (not configured)"),
      `[${status.perplexity ? "ok" : "skipped"}] perplexity`,
      `[${status.bluesky === "authenticated" ? "ok" : "skipped"}] bluesky (${status.bluesky})`,
      `[${status.tts ? "ok" : "skipped"}] qwen-tts (${deps.config.qwenTts.baseUrl})`,
      `[${status.matrix ? "ok" : "skipped"}] matrix`,
    ];
    return `Configuration status:\n${lines.join("\n")}`;
  }

  function helpText(): string {
    return [
      "Briefing Engine commands:",
      "/start <task id or name> — run a scheduled task now",
      "/list — show tasks and workflows",
      "/status — integration configuration status",
      "/help — this message",
    ].join("\n");
  }
}
