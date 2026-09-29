import type { Logger } from "../core/logger.ts";
import type { EventBus } from "../core/events/EventBus.ts";

export interface ToolContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
}

export interface Tool<TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<TResult>;
}
