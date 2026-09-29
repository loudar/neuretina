import type { EventBus } from "../events/EventBus.ts";
import type { Logger } from "../logger.ts";
import type { StatusHub } from "../status/StatusHub.ts";
import { DEFAULT_CONTEXT_ID } from "../../domain/contexts/ContextRepository.ts";
import type {
  TriggerKind,
  WorkflowRun,
  WorkflowRunStore,
} from "../../domain/runs/WorkflowRunRepository.ts";
import { errorMessage } from "../errors.ts";
import type { WorkflowRegistry } from "./Workflow.ts";

export interface WorkflowRunnerDeps {
  workflows: WorkflowRegistry;
  runs: WorkflowRunStore;
  bus: EventBus;
  logger: Logger;
  statuses: StatusHub;
}

export interface StartRunOptions {
  workflow: string;
  /** Defaults to the workflow's own context, then the engine default. */
  contextId?: string;
  trigger: TriggerKind;
  input?: Record<string, unknown>;
  /** Trigger-specific origin, recorded on the run (job id, matrix event, …). */
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
  constructor(private readonly deps: WorkflowRunnerDeps) {}

  async start(options: StartRunOptions): Promise<WorkflowRun> {
    const workflow = this.deps.workflows.get(options.workflow);
    const contextId = options.contextId ?? workflow.contextId ?? DEFAULT_CONTEXT_ID;
    const trigger = { kind: options.trigger, detail: options.detail ?? {} };

    const run = this.deps.runs.create({
      id: options.runId,
      workflow: workflow.id,
      contextId,
      trigger: options.trigger,
      triggerDetail: options.detail,
      input: options.input,
    });

    const logger = this.deps.logger.child(`workflow:${workflow.id}`);
    const started = Date.now();

    this.deps.bus.publish(
      "workflow.started",
      {
        workflow: workflow.id,
        correlationId: run.id,
        contextId,
        trigger: options.trigger,
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
        contextId,
        trigger,
        run,
      });

      const skipped =
        Boolean(output) &&
        typeof output === "object" &&
        (output as { skipped?: unknown }).skipped === true;
      const finished = this.deps.runs.finish(run.id, {
        status: skipped ? "skipped" : "succeeded",
        output,
      });

      this.deps.bus.publish(
        "workflow.finished",
        {
          workflow: workflow.id,
          correlationId: run.id,
          contextId,
          trigger: options.trigger,
          durationMs: Date.now() - started,
          output,
        },
        { source: "workflow-runner", correlationId: run.id },
      );

      return finished;
    } catch (error) {
      const message = errorMessage(error);
      this.deps.runs.finish(run.id, { status: "failed", error: message });
      this.deps.bus.publish(
        "workflow.failed",
        {
          workflow: workflow.id,
          correlationId: run.id,
          contextId,
          trigger: options.trigger,
          error: message,
        },
        { source: "workflow-runner", correlationId: run.id },
      );
      logger.error("workflow failed", { correlationId: run.id, error: message });
      throw error;
    }
  }
}
