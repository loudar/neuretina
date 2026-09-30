import type { EventBus } from "../core/events/EventBus.ts";
import type { DomainEvent } from "../core/events/types.ts";
import type { Logger } from "../core/logger.ts";
import type { StatusHandle, StatusHub } from "../core/status/StatusHub.ts";

export interface StatusServiceDeps {
  bus: EventBus;
  logger: Logger;
  hub: StatusHub;
}

/**
 * Derives coarse status-feed entries from bus events (job lifecycle, compiled
 * briefs, failures, chat commands). Fine-grained spans ("reasoning", "calling
 * tool x", "waiting for x") are instrumented directly by agents and workflows
 * via the hub.
 */
export class StatusService {
  private readonly jobHandles = new Map<string, StatusHandle>();

  constructor(private readonly deps: StatusServiceDeps) {
    const { bus, hub } = deps;

    bus.subscribe("job.started", (event) => {
      const payload = event.payload as { id: string; name: string; trigger: string };
      const key = event.correlationId ?? payload.id;
      this.jobHandles.set(
        key,
        hub.begin(`job:${payload.id}`, `Running job "${payload.name}" (${payload.trigger})`, {
          correlationId: event.correlationId,
        }),
      );
    });

    bus.subscribe("job.finished", (event) => {
      const payload = event.payload as { id: string; name: string; durationMs: number };
      const key = event.correlationId ?? payload.id;
      const handle = this.jobHandles.get(key);
      handle?.done(`Job "${payload.name}" finished (${Math.round(payload.durationMs / 1000)}s)`);
      this.jobHandles.delete(key);
    });

    bus.subscribe("job.failed", (event) => {
      const payload = event.payload as { id: string; name: string; error: string };
      const key = event.correlationId ?? payload.id;
      const handle = this.jobHandles.get(key);
      handle?.failed(`Job "${payload.name}" failed: ${payload.error}`);
      this.jobHandles.delete(key);
    });

    bus.subscribe("brief.generated", (event) => {
      const payload = event.payload as {
        briefId: string;
        topics: string[];
        sources: number;
        characters: number;
      };
      hub.push(
        `Brief compiled: ${payload.topics.join(", ")} (${payload.sources} sources, ${payload.characters} chars)`,
        {
          state: "done",
          activityId: `brief:${payload.briefId}`,
          correlationId: event.correlationId,
        },
      );
    });

    bus.subscribe("brief.skipped", (event) => {
      const payload = event.payload as { reason: string; topics?: string[] };
      const topics = payload.topics?.length ? ` (${payload.topics.join(", ")})` : "";
      hub.push(`Brief skipped${topics}: ${payload.reason}`, {
        state: "failed",
        correlationId: event.correlationId,
      });
    });

    bus.subscribe("workflow.failed", (event) => {
      const payload = event.payload as { workflow: string; error: string };
      if (event.correlationId) hub.failRunning(event.correlationId, payload.error);
      hub.push(`Workflow "${payload.workflow}" failed: ${payload.error}`, {
        state: "failed",
        correlationId: event.correlationId,
      });
    });

    bus.subscribe("workflow.cancelled", (event) => {
      if (event.correlationId) hub.failRunning(event.correlationId, "Cancelled");
    });

    bus.subscribe("chat.command.received", (event) => {
      const payload = event.payload as { command: string; sender: string };
      hub.push(`Matrix command /${payload.command} from ${payload.sender}`, {
        state: "done",
        correlationId: event.correlationId,
      });
    });
  }
}
