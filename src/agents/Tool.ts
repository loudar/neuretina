import type { Logger } from "../core/logger.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";

export interface ToolContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
  /** Name of the agent invoking the tool, when it comes from an Agent. */
  agent?: string;
  /** Activity hub for nested tool calls (code mode calls back into tools). */
  statuses?: StatusHub;
  /** Span of this tool call; nested calls parent under it. */
  statusId?: string;
}

export interface Tool<TResult = unknown> {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<TResult>;
}
