import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import type { WorkflowRegistry } from "../workflow/Workflow.ts";
import type { JobStore, ScheduledJob } from "../../domain/jobs/JobRepository.ts";
import { ValidationError, errorMessage } from "../errors.ts";

interface CronHandle {
  cron: string;
  stop(): CronHandle;
}

export interface SchedulerDeps {
  jobs: JobStore;
  workflows: WorkflowRegistry;
  bus: EventBus;
  logger: Logger;
  defaultTimezone?: string;
}

export class Scheduler {
  private readonly handles = new Map<string, CronHandle>();

  constructor(private readonly deps: SchedulerDeps) {}

  get registeredCount(): number {
    return this.handles.size;
  }

  static validateCron(expression: string, timezone?: string): void {
    try {
      const next = Bun.cron.parse(expression, Date.now(), timezone ? { tz: timezone } : undefined);
      if (!next) {
        throw new Error("expression has no future occurrences");
      }
    } catch (error) {
      throw new ValidationError(`Invalid cron expression "${expression}": ${errorMessage(error)}`);
    }
  }

  reload(): void {
    for (const handle of this.handles.values()) handle.stop();
    this.handles.clear();

    for (const job of this.deps.jobs.listEnabled()) {
      this.register(job);
    }

    this.deps.logger.info("scheduler reloaded", { jobs: this.handles.size });
  }

  register(job: ScheduledJob): void {
    this.unregister(job.id);
    if (!job.enabled) return;

    Scheduler.validateCron(job.cron, job.timezone);

    const handle = Bun.cron(
      job.cron,
      async () => {
        await this.execute(job, "schedule");
      },
      job.timezone ? { tz: job.timezone } : undefined,
    );

    this.handles.set(job.id, handle);
    this.deps.logger.debug("job registered", { id: job.id, name: job.name, cron: job.cron });
  }

  unregister(jobId: string): void {
    const handle = this.handles.get(jobId);
    if (handle) {
      handle.stop();
      this.handles.delete(jobId);
    }
  }

  async runNow(job: ScheduledJob, correlationId?: string): Promise<void> {
    await this.execute(job, "manual", correlationId);
  }

  stop(): void {
    for (const handle of this.handles.values()) handle.stop();
    this.handles.clear();
  }

  private async execute(
    job: ScheduledJob,
    trigger: "schedule" | "manual",
    correlationId?: string,
  ): Promise<void> {
    const { bus, workflows, jobs, logger } = this.deps;
    const runId = correlationId ?? crypto.randomUUID();
    const started = Date.now();

    bus.publish(
      "job.started",
      { id: job.id, name: job.name, workflow: job.workflow, trigger },
      { source: "scheduler", correlationId: runId },
    );

    logger.info("job started", { id: job.id, name: job.name, trigger });

    try {
      await workflows.run(job.workflow, job.input, { correlationId: runId });
      jobs.setRunResult(job.id, "success", Date.now());
      bus.publish(
        "job.finished",
        { id: job.id, name: job.name, workflow: job.workflow, durationMs: Date.now() - started },
        { source: "scheduler", correlationId: runId },
      );
      logger.info("job finished", { id: job.id, durationMs: Date.now() - started });
    } catch (error) {
      jobs.setRunResult(job.id, "failed", Date.now());
      bus.publish(
        "job.failed",
        { id: job.id, name: job.name, workflow: job.workflow, error: errorMessage(error) },
        { source: "scheduler", correlationId: runId },
      );
      logger.error("job failed", { id: job.id, error: errorMessage(error) });
    }
  }
}
