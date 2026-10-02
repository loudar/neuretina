import { errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import { toolInputDetail, toolResultDetail } from "../core/status/detail.ts";
import type { Tool } from "./Tool.ts";

export interface ToolInvocationContext {
  agent: string;
  /** Event source, e.g. "agent:researcher" or "codemode". */
  source: string;
  correlationId: string;
  bus: EventBus;
  logger: Logger;
  statuses?: StatusHub;
  statusId?: string;
}

export interface ToolInvocationOutcome {
  result?: unknown;
  error?: string;
  durationMs: number;
}

/**
 * Runs one tool call and records it: publishes `agent.tool.*` events and keeps
 * a child status span with the input and output for the activity feed.
 */
export async function invokeTool(
  tool: Tool | undefined,
  name: string,
  args: Record<string, unknown>,
  context: ToolInvocationContext,
): Promise<ToolInvocationOutcome> {
  const { agent, source, correlationId, bus, logger } = context;
  const started = Date.now();
  const span = context.statuses?.begin(`tool:${crypto.randomUUID()}`, name, {
    correlationId,
    ...(context.statusId ? { parentId: context.statusId } : {}),
    kind: "tool",
    detail: toolInputDetail(args),
  });

  bus.publish(
    "agent.tool.invoked",
    { agent, correlationId, tool: name, args },
    { source, correlationId },
  );

  if (!tool) {
    const error = `Unknown tool "${name}"`;
    span?.failed(`${name} failed`, toolResultDetail(args, undefined, error));
    bus.publish(
      "agent.tool.failed",
      { agent, correlationId, tool: name, error },
      { source, correlationId },
    );
    return { error, durationMs: 0 };
  }

  try {
    const result = await tool.execute(args, {
      correlationId,
      bus,
      logger,
      agent,
      ...(context.statuses ? { statuses: context.statuses } : {}),
      ...(span ? { statusId: span.id } : {}),
    });
    const durationMs = Date.now() - started;
    span?.done(name, toolResultDetail(args, result));
    bus.publish(
      "agent.tool.succeeded",
      { agent, correlationId, tool: name, durationMs, summary: summarizeResult(result) },
      { source, correlationId },
    );
    return { result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = errorMessage(error);
    span?.failed(`${name} failed`, toolResultDetail(args, undefined, message));
    bus.publish(
      "agent.tool.failed",
      { agent, correlationId, tool: name, error: message },
      { source, correlationId },
    );
    return { error: message, durationMs };
  }
}

export function summarizeResult(result: unknown): string {
  if (result && typeof result === "object" && "results" in result) {
    const results = (result as { results?: unknown[] }).results;
    return `${Array.isArray(results) ? results.length : 0} results`;
  }
  const text = JSON.stringify(result ?? null);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
