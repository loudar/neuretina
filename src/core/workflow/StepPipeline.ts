import type { DeliveryMessage, DeliveryRouter } from "../../delivery/DeliveryService.ts";
import { errorMessage } from "../errors.ts";
import type { StepDefinition, WorkflowDefinition } from "./definition.ts";
import type { WorkflowRunContext } from "./Workflow.ts";

/**
 * Restart-safe pipeline progress: the outputs of every completed step, keyed
 * by step id and then output kind, plus the delivery keys already handled.
 * JSON-serializable so it can be stored on the run.
 */
export interface PipelineState {
  steps: Record<string, Record<string, unknown>>;
  /** "stepId:outputKind" keys whose delivery was already attempted. */
  delivered: Record<string, true>;
  /** The run outcome when a step halted the pipeline; a resumed run stays halted. */
  halted?: unknown;
}

export interface PipelineOptions {
  /** Resolved workflow inputs keyed by input id. */
  inputs: Record<string, unknown>;
  /** Raw run options the handlers may interpret (deliver, generateAudio, …). */
  options: Record<string, unknown>;
  context: WorkflowRunContext;
  /** Progress of an earlier attempt, to skip completed steps. */
  resume?: PipelineState;
  /** Disables output delivery for this run (defaults to enabled). */
  deliver?: boolean;
  /** Routes deliverable outputs to the channels assigned to their step output. */
  delivery?: { workflow: string; router: DeliveryRouter };
}

export interface PipelineOutcome {
  /** Outputs of every step that ran, keyed by step id. */
  outputs: Map<string, Record<string, unknown>>;
  /** Set when a step halted the pipeline; this is the run's outcome. */
  halted?: unknown;
  /** Channels attempted across all delivered outputs. */
  delivered: number;
}

/**
 * Executes a workflow definition step by step, checkpointing after every step
 * and reusing completed steps from an earlier attempt. Deliverable outputs are
 * routed through the channels assigned to their (step, output) target.
 */
export class StepPipeline {
  constructor(private readonly definition: WorkflowDefinition) {}

  async run(options: PipelineOptions): Promise<PipelineOutcome> {
    const state: PipelineState = options.resume ?? { steps: {}, delivered: {} };
    state.steps ??= {};
    state.delivered ??= {};

    const outputs = new Map<string, Record<string, unknown>>();
    const shouldDeliver = options.deliver !== false && options.delivery !== undefined;
    let delivered = 0;

    // A resumed run that already halted is done; its outputs stay available.
    if (state.halted !== undefined) {
      for (const step of this.definition.steps) {
        const completed = state.steps[step.id];
        if (completed !== undefined) outputs.set(step.id, completed);
      }
      return { outputs, halted: state.halted, delivered: 0 };
    }

    for (const step of this.definition.steps) {
      options.context.signal?.throwIfAborted();

      const completed = state.steps[step.id];
      if (completed !== undefined) {
        outputs.set(step.id, completed);
        // A previous attempt may have stopped between a step and its delivery.
        if (shouldDeliver) {
          delivered += await this.deliverOutputs(step, completed, state, options);
        }
        continue;
      }

      let result: Awaited<ReturnType<StepDefinition["run"]>>;
      try {
        result = await step.run({
          inputs: options.inputs,
          options: options.options,
          outputs,
          run: options.context,
        });
      } catch (error) {
        options.context.logger.warn("step failed", {
          step: step.id,
          error: errorMessage(error),
        });
        throw error;
      }

      const stepOutputs = result?.outputs ?? {};
      state.steps[step.id] = stepOutputs;
      outputs.set(step.id, stepOutputs);
      options.context.checkpoint?.(state);

      if (shouldDeliver) {
        delivered += await this.deliverOutputs(step, stepOutputs, state, options);
      }

      if (result?.halt !== undefined) {
        state.halted = result.halt;
        options.context.checkpoint?.(state);
        delivered += await this.deliverFallback(result.fallback, state, options, shouldDeliver);
        return { outputs, halted: result.halt, delivered };
      }
    }

    return { outputs, halted: undefined, delivered };
  }

  /** Delivers each present, deliverable output of a finished step exactly once. */
  private async deliverOutputs(
    step: StepDefinition,
    stepOutputs: Record<string, unknown>,
    state: PipelineState,
    options: PipelineOptions,
  ): Promise<number> {
    const { workflow, router } = options.delivery!;
    let delivered = 0;

    for (const spec of step.outputs) {
      if (spec.deliver === undefined) continue;
      const key = `${step.id}:${spec.kind}`;
      if (state.delivered[key]) continue;
      const value = stepOutputs[spec.kind];
      if (value === undefined) continue;

      const message = spec.deliver(value);
      const channels = message
        ? router.channelsFor({ workflow, step: step.id, output: spec.kind })
        : [];
      if (message && channels.length > 0) {
        delivered += await this.send(router, message, channels, options.context);
      }

      state.delivered[key] = true;
      options.context.checkpoint?.(state);
    }

    return delivered;
  }

  /** A halting step's notice goes out to every channel assigned to the workflow. */
  private async deliverFallback(
    message: DeliveryMessage | undefined,
    state: PipelineState,
    options: PipelineOptions,
    shouldDeliver: boolean,
  ): Promise<number> {
    if (!shouldDeliver || !message || state.delivered["(halt)"]) return 0;
    const { workflow, router } = options.delivery!;
    state.delivered["(halt)"] = true;
    options.context.checkpoint?.(state);

    const channels = router.workflowChannels(workflow);
    if (channels.length === 0) return 0;
    return this.send(router, message, channels, options.context);
  }

  private async send(
    router: DeliveryRouter,
    message: DeliveryMessage,
    channels: string[],
    context: WorkflowRunContext,
  ): Promise<number> {
    const attempts = await router.deliver({
      briefId: message.reference ?? context.correlationId,
      runId: context.correlationId,
      channels,
      kinds: message.kinds,
      summary: message.summary,
      html: message.html,
      narration: message.narration,
      audio: message.audio,
      audioMime: message.audioMime,
    });
    return attempts.length;
  }
}
