import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import type { StatusHub } from "../status/StatusHub.ts";
import { NotFoundError, errorMessage } from "../errors.ts";

export interface WorkflowContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
  statuses: StatusHub;
}

export interface Workflow<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly description: string;
  run(input: TInput, context: WorkflowContext): Promise<TOutput>;
}

export interface WorkflowRunOptions {
  correlationId?: string;
}

export interface WorkflowRunResult<TOutput = unknown> {
  correlationId: string;
  output: TOutput;
  durationMs: number;
}

export class WorkflowRegistry {
  private readonly workflows = new Map<string, Workflow>();

  constructor(
    private readonly deps: { bus: EventBus; logger: Logger; statuses: StatusHub },
  ) {}

  register<TInput, TOutput>(workflow: Workflow<TInput, TOutput>): void {
    this.workflows.set(workflow.id, workflow as Workflow);
  }

  get(id: string): Workflow {
    const workflow = this.workflows.get(id);
    if (!workflow) throw new NotFoundError(`Workflow "${id}" is not registered`);
    return workflow;
  }

  list(): Array<{ id: string; description: string }> {
    return [...this.workflows.values()].map(({ id, description }) => ({ id, description }));
  }

  async run<TOutput = unknown>(
    id: string,
    input: unknown,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunResult<TOutput>> {
    const workflow = this.get(id);
    const correlationId = options.correlationId ?? crypto.randomUUID();
    const logger = this.deps.logger.child(`workflow:${id}`);
    const started = Date.now();

    this.deps.bus.publish(
      "workflow.started",
      { workflow: id, correlationId, input },
      { source: "workflow-registry", correlationId },
    );

    try {
      const output = (await workflow.run(input, {
        correlationId,
        bus: this.deps.bus,
        logger,
        statuses: this.deps.statuses,
      })) as TOutput;

      const durationMs = Date.now() - started;
      this.deps.bus.publish(
        "workflow.finished",
        { workflow: id, correlationId, durationMs, output },
        { source: "workflow-registry", correlationId },
      );

      return { correlationId, output, durationMs };
    } catch (error) {
      this.deps.bus.publish(
        "workflow.failed",
        { workflow: id, correlationId, error: errorMessage(error) },
        { source: "workflow-registry", correlationId },
      );
      logger.error("workflow failed", { correlationId, error: errorMessage(error) });
      throw error;
    }
  }
}
