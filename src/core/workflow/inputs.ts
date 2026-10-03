import type { TopicStore } from "../../domain/topics/TopicRepository.ts";
import type { WorkflowInputSpec } from "./definition.ts";

/** Stores input kinds validate and resolve against; grows with new kinds. */
export interface WorkflowInputDeps {
  topics: TopicStore;
}

export interface WorkflowInputParseOptions {
  /** Whether required inputs must hold a value (creation may defer this). */
  requireFilled: boolean;
}

export interface WorkflowInputResolveOptions {
  contextId: string;
}

/**
 * One workflow input kind. `parse` validates and normalizes the configured
 * (stored) value; context kinds also `resolve` it into the material steps
 * consume. Registering a kind is all it takes to support it end to end.
 */
export interface WorkflowInputKind<TStored = unknown, TResolved = unknown> {
  id: string;
  title: string;
  /** Context inputs contribute material (topics today, files later). */
  context?: boolean;
  parse(
    value: unknown,
    spec: WorkflowInputSpec,
    deps: WorkflowInputDeps,
    options: WorkflowInputParseOptions,
  ): TStored;
  resolve?(
    value: unknown,
    spec: WorkflowInputSpec,
    deps: WorkflowInputDeps,
    options: WorkflowInputResolveOptions,
  ): TResolved;
}

/** The input kinds a workflow may declare; one registry per engine. */
export class WorkflowInputRegistry {
  private readonly kinds = new Map<string, WorkflowInputKind<unknown, unknown>>();

  register<TStored, TResolved>(kind: WorkflowInputKind<TStored, TResolved>): void {
    this.kinds.set(kind.id, kind as WorkflowInputKind<unknown, unknown>);
  }

  get(id: string): WorkflowInputKind<unknown, unknown> | undefined {
    return this.kinds.get(id);
  }

  /** Every registered kind, for settings UIs and diagnostics. */
  list(): WorkflowInputKind<unknown, unknown>[] {
    return [...this.kinds.values()];
  }

  /** Validates every declared input; unknown kinds pass through untouched. */
  parseInputs(
    specs: WorkflowInputSpec[],
    value: unknown,
    deps: WorkflowInputDeps,
    options: WorkflowInputParseOptions,
  ): Record<string, unknown> {
    const record = isRecord(value) ? value : {};
    const result: Record<string, unknown> = {};
    for (const spec of specs) {
      const raw = record[spec.id];
      const kind = this.kinds.get(spec.kind);
      if (!kind) {
        if (raw !== undefined) result[spec.id] = raw;
        continue;
      }
      result[spec.id] = kind.parse(raw, spec, deps, options);
    }
    return result;
  }

  /** Resolves context-kind inputs into the material steps consume. */
  resolveContext(
    specs: WorkflowInputSpec[],
    values: Record<string, unknown>,
    deps: WorkflowInputDeps,
    options: WorkflowInputResolveOptions,
  ): Record<string, unknown> {
    const context: Record<string, unknown> = {};
    for (const spec of specs) {
      const kind = this.kinds.get(spec.kind);
      if (!kind?.context || !kind.resolve) continue;
      context[spec.id] = kind.resolve(values[spec.id], spec, deps, options);
    }
    return context;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
