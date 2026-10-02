import { ValidationError } from "../core/errors.ts";
import type { AppEvents } from "../core/events/AppEvents.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { ArtifactStore } from "../domain/artifacts/ArtifactRepository.ts";

/** Coerces a command payload to a record (empty object when it is not one). */
export function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

export function asOptionalRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`"${key}" must be an object`);
  }
  return value as Record<string, unknown>;
}

export function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new ValidationError(`"${key}" must be a non-empty string`);
  }
  return value.trim();
}

/** The `id` of a command payload, required. */
export function idOf(payload: unknown): string {
  return requireString(asRecord(payload), "id");
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new ValidationError(`"${key}" must be a string`);
  return value.trim() || undefined;
}

export function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

/** Array of non-empty strings, used by kind-specific input checks. */
export function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new ValidationError(`"${field}" must be an array`);
  }
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ValidationError(`"${field}[${index}]" must be a non-empty string`);
    }
    return entry.trim();
  });
}

/** Publishes a command-sourced domain event. */
export function publish<K extends keyof AppEvents>(
  bus: EventBus,
  topic: K,
  payload: AppEvents[K],
  context: { correlationId?: string },
): void {
  bus.publish(topic, payload, { source: "commands", correlationId: context.correlationId });
}

export function publishDeliveryUpdated(
  bus: EventBus,
  action: "create" | "update" | "delete" | "attach" | "detach",
  correlationId?: string,
): void {
  bus.publish("delivery.updated", { action }, { source: "commands", correlationId });
}

export function publishUserWorkflowChanged(
  bus: EventBus,
  action: "create" | "update" | "delete",
  workflowId: string,
  correlationId?: string,
): void {
  bus.publish(
    "workflow.user.changed",
    { action, workflowId },
    { source: "commands", correlationId },
  );
}

/**
 * Deletes every artifact a run produced (children included, since artifacts
 * are collected by correlation id) and reports how many were removed.
 */
export function removeRunArtifacts(
  deps: { artifacts: ArtifactStore; bus: EventBus },
  runId: string,
  context: { correlationId?: string },
): number {
  let removed = 0;
  for (let round = 0; round < 20; round++) {
    const batch = deps.artifacts.list({ correlationId: runId, limit: 500 });
    if (batch.length === 0) break;
    for (const artifact of batch) {
      deps.artifacts.remove(artifact.id);
      removed += 1;
      publish(deps.bus, "artifact.deleted", { artifactId: artifact.id, kind: artifact.kind }, context);
    }
  }
  return removed;
}
