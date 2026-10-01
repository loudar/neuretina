import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import type { StatusHub } from "../status/StatusHub.ts";
import type { CostTracker } from "../cost/CostTracker.ts";
import type { TriggerKind, WorkflowRun } from "../../domain/runs/WorkflowRunRepository.ts";
import { NotFoundError } from "../errors.ts";
import { describeWorkflow, type WorkflowDefinition, type WorkflowInfo } from "./definition.ts";
import { portType } from "./ports.ts";

export interface WorkflowContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
  statuses: StatusHub;
  /** Per-run cost accumulator; absent for direct (non-runner) invocations. */
  cost?: CostTracker;
  /** Aborted when the run is cancelled; checkpoints call `signal.throwIfAborted()`. */
  signal?: AbortSignal;
  /** Persists a progress checkpoint so a restarted runner can resume the run. */
  checkpoint?: (data: unknown) => void;
  /** Progress checkpointed by an earlier attempt; skip everything already done. */
  resume?: unknown;
}

/** What started a run; `detail` carries the trigger-specific origin. */
export interface TriggerInfo {
  kind: TriggerKind;
  detail: Record<string, unknown>;
}

/** Runtime context a workflow receives: base context plus run identity/scope. */
export interface WorkflowRunContext extends WorkflowContext {
  /** Context the run belongs to (defaults to the engine's default context). */
  contextId?: string;
  /** The persisted run record (absent for direct/unit-test invocations). */
  run?: WorkflowRun;
  trigger?: TriggerInfo;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  /** Public shape (inputs, steps, ports) used by the UI and delivery routing. */
  readonly definition: WorkflowDefinition;
  run(input: TInput, context: WorkflowRunContext): Promise<TOutput>;
}

/**
 * Code-registered workflow definitions. Execution lives in `WorkflowRunner`,
 * which persists a run and gives the workflow its run context.
 */
export class WorkflowRegistry {
  private readonly workflows = new Map<string, Workflow>();

  constructor(
    private readonly deps: { bus: EventBus; logger: Logger; statuses: StatusHub },
  ) {}

  register<TInput, TOutput>(workflow: Workflow<TInput, TOutput>): void {
    this.workflows.set(workflow.definition.id, workflow as Workflow);
    this.warnUnknownPortTypes(workflow.definition);
  }

  /** Ports must use registered types so composition rules keep working. */
  private warnUnknownPortTypes(definition: WorkflowDefinition): void {
    for (const step of definition.steps) {
      for (const port of [...step.inputs, ...step.outputs]) {
        if (portType(port.kind)) continue;
        this.deps.logger.warn("unknown port type", {
          workflow: definition.id,
          step: step.id,
          kind: port.kind,
        });
      }
    }
  }

  /** Removes a workflow definition; nothing happens when it is unknown. */
  unregister(id: string): void {
    this.workflows.delete(id);
  }

  get(id: string): Workflow {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new NotFoundError(`Workflow "${id}" is not registered`);
    return workflow;
  }

  /** Registered workflows with their trigger kinds, for dispatch and the UI. */
  definitions(): Array<{ workflow: Workflow; triggers: TriggerKind[] }> {
    return [...this.workflows.values()].map((workflow) => ({
      workflow,
      triggers: workflow.definition.triggers.map((binding) => binding.kind),
    }));
  }

  /** Serializable definitions (drops handlers), for commands and the UI. */
  list(): WorkflowInfo[] {
    return [...this.workflows.values()].map((workflow) => describeWorkflow(workflow.definition));
  }
}
