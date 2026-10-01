import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import { NotFoundError, errorMessage } from "../errors.ts";

export interface CommandContext {
  type: string;
  correlationId: string;
  /** Ingress the command arrived through, e.g. "ui" or "webhook". */
  source: string;
  bus: EventBus;
  logger: Logger;
}

export interface ExecuteOptions {
  source?: string;
}

export type CommandHandler = (
  payload: unknown,
  context: CommandContext,
) => unknown | Promise<unknown>;

export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();
  private readonly quiet = new Set<string>();

  constructor(
    private readonly deps: { bus: EventBus; logger: Logger },
  ) {}

  register(type: string, handler: CommandHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  /**
   * Quiet commands (reads, long-polls) do not produce audit events on the bus,
   * so polling never feeds itself and the event log stays meaningful.
   */
  markQuiet(type: string): void {
    this.quiet.add(type);
  }

  isQuiet(type: string): boolean {
    return this.quiet.has(type);
  }

  list(): string[] {
    return [...this.handlers.keys()].sort();
  }

  async execute(
    type: string,
    payload: unknown,
    correlationId: string,
    options: ExecuteOptions = {},
  ): Promise<unknown> {
    const handler = this.handlers.get(type);
    const eventSource = `commands:${type}`;
    const quiet = this.quiet.has(type);

    if (!handler) {
      const error = new NotFoundError(`Unknown message type "${type}"`);
      this.deps.bus.publish(
        "command.failed",
        { type, correlationId, error: errorMessage(error) },
        { source: eventSource, correlationId },
      );
      throw error;
    }

    try {
      const result = await handler(payload, {
        type,
        correlationId,
        source: options.source ?? "api",
        bus: this.deps.bus,
        logger: this.deps.logger,
      });

      const value = result ?? null;
      if (!quiet) {
        this.deps.bus.publish(
          "command.completed",
          { type, correlationId, result: value },
          { source: eventSource, correlationId },
        );
      }
      return value;
    } catch (error) {
      if (!quiet) {
        this.deps.bus.publish(
          "command.failed",
          { type, correlationId, error: errorMessage(error) },
          { source: eventSource, correlationId },
        );
        this.deps.logger.warn("command failed", { type, error: errorMessage(error) });
      }
      throw error;
    }
  }
}
