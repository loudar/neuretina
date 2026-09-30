import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import type { StatusHub } from "../status/StatusHub.ts";
import type { CostTracker } from "../cost/CostTracker.ts";
import type { TriggerKind, WorkflowRun } from "../../domain/runs/WorkflowRunRepository.ts";
import { NotFoundError } from "../errors.ts";

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

export interface WorkflowTriggerBinding {
  kind: TriggerKind;
  /** Only dispatch when this returns true (e.g. only Matrix replies to the bot). */
  when?: (detail: Record<string, unknown>) => boolean;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly description: string;
  /** Context this workflow belongs to; defaults to the engine's default context. */
  readonly contextId?: string;
  /** Extra triggers this workflow accepts (schedule jobs and manual runs are implicit). */
  readonly triggers?: WorkflowTriggerBinding[];
  run(input: TInput, context: WorkflowRunContext): Promise<TOutput>;
}

export interface WorkflowInfo {
  id: string;
  description: string;
  contextId?: string;
  triggers: TriggerKind[];
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
    this.workflows.set(workflow.id, workflow as Workflow);
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

  /** Definitions with their trigger kinds, for the UI and trigger dispatch. */
  definitions(): Array<{ workflow: Workflow; triggers: TriggerKind[] }> {
    return [...this.workflows.values()].map((workflow) => ({
      workflow,
      triggers: workflow.triggers?.map((binding) => binding.kind) ?? [],
    }));
  }

  list(): WorkflowInfo[] {
    return [...this.workflows.values()].map(({ id, description, contextId, triggers }) => ({
      id,
      description,
      contextId,
      triggers: triggers?.map((binding) => binding.kind) ?? [],
    }));
  }
}
