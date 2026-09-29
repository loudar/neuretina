import type { Logger } from "../logger.ts";
import type { TriggerKind, WorkflowRun } from "../../domain/runs/WorkflowRunRepository.ts";
import { errorMessage } from "../errors.ts";
import type { WorkflowRegistry } from "./Workflow.ts";
import type { WorkflowRunner } from "./WorkflowRunner.ts";

export interface DispatchOptions {
  /** Overrides the workflow's own context when set. */
  contextId?: string;
  input?: Record<string, unknown>;
  /** Trigger-specific origin, passed to each binding's `when` and recorded. */
  detail: Record<string, unknown>;
  runId?: string;
}

/**
 * Fans a trigger event out to every workflow bound to it. Bindings live on the
 * workflow definitions (`triggers`), so adding a new triggerable workflow is
 * just registering it with a binding.
 */
export class TriggerDispatcher {
  constructor(
    private readonly deps: {
      workflows: WorkflowRegistry;
      runner: WorkflowRunner;
      logger: Logger;
    },
  ) {}

  /** Workflows bound to this trigger kind whose condition passes. */
  bindings(kind: TriggerKind, detail: Record<string, unknown>): string[] {
    return this.deps.workflows
      .definitions()
      .filter(({ workflow }) =>
        workflow.triggers?.some(
          (binding) => binding.kind === kind && (!binding.when || binding.when(detail)),
        ),
      )
      .map(({ workflow }) => workflow.id);
  }

  /**
   * Runs every matching workflow in order. Individual failures are recorded on
   * their run (and logged), never thrown, so one bad workflow cannot break the
   * trigger.
   */
  async dispatch(kind: TriggerKind, options: DispatchOptions): Promise<WorkflowRun[]> {
    const runs: WorkflowRun[] = [];

    for (const workflowId of this.bindings(kind, options.detail)) {
      try {
        runs.push(
          await this.deps.runner.start({
            workflow: workflowId,
            contextId: options.contextId,
            trigger: kind,
            input: options.input,
            detail: options.detail,
            runId: options.runId,
          }),
        );
      } catch (error) {
        this.deps.logger.warn("triggered workflow failed", {
          workflow: workflowId,
          trigger: kind,
          error: errorMessage(error),
        });
      }
    }

    return runs;
  }
}
