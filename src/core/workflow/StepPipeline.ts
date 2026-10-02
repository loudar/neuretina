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
  /**
   * Step id the pipeline stops after: everything up to and including it runs
   * (and its outputs are delivered), later steps never start. Unknown ids are
   * ignored, so a stale setting never blocks a run.
   */
  stopAfter?: string;
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
 * Executes a workflow definition as a dependency graph: every step whose
 * `after` dependencies are complete starts immediately, so independent
 * actions (e.g. TTS and event extraction) run concurrently. Steps without
 * `after` depend on every earlier step and stay sequential.
 *
 * Completed steps are checkpointed and reused on resume, and each deliverable
 * output is routed through the channels assigned to its (step, output) target.
 */
export class StepPipeline {
  constructor(private readonly definition: WorkflowDefinition) {}

  async run(options: PipelineOptions): Promise<PipelineOutcome> {
    const state: PipelineState = options.resume ?? { steps: {}, delivered: {} };
    state.steps ??= {};
    state.delivered ??= {};

    const steps = this.definition.steps;
    // Only the prefix up to and including the stop step is eligible to run.
    const stopIndex = options.stopAfter
      ? steps.findIndex((step) => step.id === options.stopAfter)
      : -1;
    const lastIndex = stopIndex >= 0 ? stopIndex : steps.length - 1;
    const dependencies = this.dependencies();
    const closures = this.closures(dependencies);
    const outputs = new Map<string, Record<string, unknown>>();
    const completed = new Set<string>();
    const inFlight = new Map<string, Promise<void>>();
    const shouldDeliver = options.deliver !== false && options.delivery !== undefined;
    let delivered = 0;

    // Resume: completed steps are restored (replaying any missing delivery)
    // before anything new starts.
    for (const [index, step] of steps.entries()) {
      if (index > lastIndex) continue;
      const saved = state.steps[step.id];
      if (saved === undefined) continue;
      outputs.set(step.id, saved);
      completed.add(step.id);
      if (shouldDeliver) {
        delivered += await this.deliverOutputs(step, saved, state, options);
      }
    }

    // A resumed run that already halted is done; its outputs stay available.
    if (state.halted !== undefined) {
      return { outputs, halted: state.halted, delivered };
    }

    let halted: unknown;
    let haltFallback: DeliveryMessage | undefined;
    let failure: unknown;
    let failed = false;
    let wake: (() => void) | null = null;

    const notify = (): void => {
      const resume = wake;
      wake = null;
      resume?.();
    };

    const start = (step: StepDefinition): void => {
      const promise = (async () => {
        try {
          const result = await step.run({
            inputs: options.inputs,
            options: options.options,
            // Handlers only see the outputs of the steps they depend on, so
            // concurrent siblings cannot leak half-finished values.
            outputs: this.visibleOutputs(step, closures, outputs),
            run: options.context,
          });

          const stepOutputs = result?.outputs ?? {};
          state.steps[step.id] = stepOutputs;
          outputs.set(step.id, stepOutputs);
          options.context.checkpoint?.(state);

          if (shouldDeliver) {
            delivered += await this.deliverOutputs(step, stepOutputs, state, options);
          }
          completed.add(step.id);

          if (result?.halt !== undefined && halted === undefined) {
            halted = result.halt;
            haltFallback = result.fallback;
          }
        } catch (error) {
          options.context.logger.warn("step failed", {
            step: step.id,
            error: errorMessage(error),
          });
          if (!failed) {
            failed = true;
            failure = error;
          }
        } finally {
          inFlight.delete(step.id);
          notify();
        }
      })();
      inFlight.set(step.id, promise);
    };

    const ready = (step: StepDefinition): boolean =>
      (dependencies.get(step.id) ?? []).every((id) => completed.has(id));

    while (true) {
      // Starting stops on the first failure, halt or cancellation; in-flight
      // steps still settle so their work is recorded.
      if (!failed && halted === undefined && !options.context.signal?.aborted) {
        for (const [index, step] of steps.entries()) {
          if (index > lastIndex) continue;
          if (completed.has(step.id) || inFlight.has(step.id)) continue;
          if (!ready(step)) continue;
          start(step);
        }
      }
      if (inFlight.size === 0) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }

    options.context.signal?.throwIfAborted();
    if (failed) throw failure;

    if (halted !== undefined) {
      state.halted = halted;
      options.context.checkpoint?.(state);
      delivered += await this.deliverFallback(haltFallback, state, options, shouldDeliver);
      return { outputs, halted, delivered };
    }

    return { outputs, halted: undefined, delivered };
  }

  /** Step dependencies: declared `after`, or every earlier step. */
  private dependencies(): Map<string, string[]> {
    const steps = this.definition.steps;
    const position = new Map(steps.map((step, index) => [step.id, index]));
    const dependencies = new Map<string, string[]>();

    for (const [index, step] of steps.entries()) {
      const after = step.after ?? steps.slice(0, index).map((entry) => entry.id);
      for (const id of after) {
        const at = position.get(id);
        if (at === undefined || at >= index) {
          throw new Error(`Step "${step.id}" depends on "${id}", which is not an earlier step`);
        }
      }
      dependencies.set(step.id, [...after]);
    }

    return dependencies;
  }

  /** Transitive dependencies per step, for the handler's output view. */
  private closures(dependencies: Map<string, string[]>): Map<string, string[]> {
    const closures = new Map<string, string[]>();
    for (const id of dependencies.keys()) {
      const seen = new Set<string>();
      const stack = [...(dependencies.get(id) ?? [])];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (seen.has(current)) continue;
        seen.add(current);
        stack.push(...(dependencies.get(current) ?? []));
      }
      closures.set(id, [...seen]);
    }
    return closures;
  }

  private visibleOutputs(
    step: StepDefinition,
    closures: Map<string, string[]>,
    outputs: Map<string, Record<string, unknown>>,
  ): Map<string, Record<string, unknown>> {
    // Definition order matters: consumers like `latestOutput` pick the last
    // matching output, which must be the most recent step in pipeline order.
    const closure = new Set(closures.get(step.id) ?? []);
    const visible = new Map<string, Record<string, unknown>>();
    for (const entry of this.definition.steps) {
      if (!closure.has(entry.id)) continue;
      const value = outputs.get(entry.id);
      if (value !== undefined) visible.set(entry.id, value);
    }
    return visible;
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
      title: message.title,
      summary: message.summary,
      html: message.html,
      narration: message.narration,
      audio: message.audio,
      audioMime: message.audioMime,
    });
    return attempts.length;
  }
}
