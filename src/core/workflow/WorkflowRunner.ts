import type { EventBus } from "../events/EventBus.ts";
import type { Logger } from "../logger.ts";
import type { StatusHub } from "../status/StatusHub.ts";
import { CostTracker } from "../cost/CostTracker.ts";
import { DEFAULT_CONTEXT_ID } from "../../domain/contexts/ContextRepository.ts";
import type {
  TriggerKind,
  WorkflowRun,
  WorkflowRunStore,
} from "../../domain/runs/WorkflowRunRepository.ts";
import { errorMessage } from "../errors.ts";
import type { TriggerInfo, Workflow, WorkflowRegistry } from "./Workflow.ts";

export interface WorkflowRunnerDeps {
  workflows: WorkflowRegistry;
  runs: WorkflowRunStore;
  bus: EventBus;
  logger: Logger;
  statuses: StatusHub;
  /** Live price table for metered providers (settings can change at runtime). */
}

export interface StartRunOptions {
  workflow: string;
  /** Defaults to the workflow's own context, then the engine default. */
  contextId?: string;
  trigger: TriggerKind;
  input?: Record<string, unknown>;
  /** Trigger-specific origin, recorded on the run (job id, matrix event, â€¦). */
  detail?: Record<string, unknown>;
  /** Reuse a known id (the scheduler passes its correlation id). */
  runId?: string;
}

/**
 * Starts workflow runs: persists the run, executes the workflow with its run
 * context (correlation id = run id) and records the outcome. Every trigger
 * (schedule, matrix, manual) goes through here.
 */
export class WorkflowRunner {
  private readonly active = new Map<string, { controller: AbortController; done: Promise<void> }>();

  constructor(private readonly deps: WorkflowRunnerDeps) {}

  /**
   * Signals cancellation of an active run and resolves once it has unwound
   * (`false` when the run is not active). Callers own the cleanup: delete the
   * run and its artifacts afterwards.
   */
  async cancel(id: string): Promise<boolean> {
    const active = this.active.get(id);
    if (!active) return false;
    active.controller.abort();
    await active.done;
    return true;
  }

  async start(options: StartRunOptions): Promise<WorkflowRun> {
    const workflow = this.deps.workflows.get(options.workflow);
    const contextId = options.contextId ?? workflow.definition.contextId ?? DEFAULT_CONTEXT_ID;
    const trigger: TriggerInfo = { kind: options.trigger, detail: options.detail ?? {} };

    const run = this.deps.runs.create({
      id: options.runId,
      workflow: workflow.definition.id,
      contextId,
      trigger: options.trigger,
      triggerDetail: options.detail,
      input: options.input,
    });

    return this.execute(run, workflow, { contextId, trigger, input: options.input });
  }

  /** Executes an existing run, e.g. one interrupted by a restart. */
  async resume(run: WorkflowRun): Promise<WorkflowRun> {
    const workflow = this.deps.workflows.get(run.workflow);
    return this.execute(run, workflow, {
      contextId: run.contextId,
      trigger: { kind: run.trigger, detail: run.triggerDetail },
      input: run.input,
    });
  }

  /**
   * Resumes every persisted run that was still running when the process
   * stopped. Runs whose workflow is no longer registered are failed; the
   * others continue from their checkpoints (fire-and-forget). Returns how
   * many were resumed.
   */
  async resumeInterrupted(): Promise<number> {
    const interrupted = this.deps.runs.list({ limit: 500 }).filter((run) => run.status === "running");
    let resumed = 0;

    for (const run of interrupted) {
      try {
        this.deps.workflows.get(run.workflow);
      } catch {
        this.deps.runs.finish(run.id, {
          status: "failed",
          error: "Workflow is no longer registered",
        });
        continue;
      }

      void this.resume(run).catch((error) => {
        this.deps.logger.warn("resuming an interrupted run failed", {
          runId: run.id,
          error: errorMessage(error),
        });
      });
      resumed += 1;
    }

    return resumed;
  }

  private async execute(
    run: WorkflowRun,
    workflow: Workflow,
    options: { contextId: string; trigger: TriggerInfo; input?: Record<string, unknown> },
  ): Promise<WorkflowRun> {
    const workflowId = workflow.definition.id;
    const logger = this.deps.logger.child(`workflow:${workflowId}`);
    const started = Date.now();
    const cost = new CostTracker();
    const controller = new AbortController();
    let settled!: () => void;
    const done = new Promise<void>((resolve) => {
      settled = resolve;
    });
    this.active.set(run.id, { controller, done });

    this.deps.bus.publish(
      "workflow.started",
      {
        workflow: workflowId,
        correlationId: run.id,
        contextId: options.contextId,
        trigger: options.trigger.kind,
        input: options.input,
      },
      { source: "workflow-runner", correlationId: run.id },
    );

    try {
      const output = await workflow.run(options.input, {
        correlationId: run.id,
        bus: this.deps.bus,
        logger,
        statuses: this.deps.statuses,
        cost,
        signal: controller.signal,
        contextId: options.contextId,
        trigger: options.trigger,
        run,
        checkpoint: (data) => this.deps.runs.saveCheckpoint(run.id, data),
        resume: run.checkpoint,
      });

      const skipped =
        Boolean(output) &&
        typeof output === "object" &&
        (output as { skipped?: unknown }).skipped === true;
      const report = costReport(cost);
      const finished = this.deps.runs.finish(run.id, {
        status: skipped ? "skipped" : "succeeded",
        output,
        ...(report ? { cost: report } : {}),
      });

      this.deps.bus.publish(
        "workflow.finished",
        {
          workflow: workflowId,
          correlationId: run.id,
          contextId: options.contextId,
          trigger: options.trigger.kind,
          durationMs: Date.now() - started,
          output,
          ...(report ? { cost: report } : {}),
        },
        { source: "workflow-runner", correlationId: run.id },
      );

      return finished;
    } catch (error) {
      const message = errorMessage(error);
      const report = costReport(cost);

      if (controller.signal.aborted) {
        const cancelled = this.deps.runs.finish(run.id, {
          status: "cancelled",
          output: { cancelled: true },
          ...(report ? { cost: report } : {}),
        });
        this.deps.bus.publish(
          "workflow.cancelled",
          {
            workflow: workflowId,
            correlationId: run.id,
            contextId: options.contextId,
            trigger: options.trigger.kind,
          },
          { source: "workflow-runner", correlationId: run.id },
        );
        logger.warn("workflow cancelled", { correlationId: run.id });
        return cancelled;
      }

      this.deps.runs.finish(run.id, {
        status: "failed",
        error: message,
        ...(report ? { cost: report } : {}),
      });
      this.deps.bus.publish(
        "workflow.failed",
        {
          workflow: workflowId,
          correlationId: run.id,
          contextId: options.contextId,
          trigger: options.trigger.kind,
          error: message,
          ...(report ? { cost: report } : {}),
        },
        { source: "workflow-runner", correlationId: run.id },
      );
      logger.error("workflow failed", { correlationId: run.id, error: message });
      throw error;
    } finally {
      this.active.delete(run.id);
      settled();
    }
  }
}

function costReport(tracker: CostTracker): ReturnType<CostTracker["report"]> | undefined {
  const report = tracker.report();
  return report.lines.length > 0 ? report : undefined;
}
