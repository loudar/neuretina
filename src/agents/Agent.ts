import type { Logger } from "../core/logger.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import type { LlmMessage, LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import { errorMessage } from "../core/errors.ts";
import type { Tool } from "./Tool.ts";

export interface AgentOptions {
  name: string;
  description?: string;
  systemPrompt: string;
  llm: LlmProvider;
  tools?: Tool[];
  maxSteps?: number;
  /** Upper bound on total tool invocations per run (guards runaway research). */
  maxToolCalls?: number;
  model?: string;
  temperature?: number;
  statuses?: StatusHub;
}

export interface AgentContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
}

export interface AgentToolInvocation {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface AgentStep {
  index: number;
  text: string;
  invocations: AgentToolInvocation[];
  finishReason: string;
}

export interface AgentRunResult {
  agent: string;
  text: string;
  steps: AgentStep[];
  durationMs: number;
}

const MAX_TOOL_RESULT_CHARS = 8000;

export class Agent {
  readonly name: string;
  readonly description: string;

  private readonly systemPrompt: string;
  private readonly llm: LlmProvider;
  private readonly tools: Map<string, Tool>;
  private readonly toolList: Tool[];
  private readonly maxSteps: number;
  private readonly maxToolCalls: number;
  private readonly model?: string;
  private readonly temperature?: number;
  private readonly statuses?: StatusHub;

  constructor(options: AgentOptions) {
    this.name = options.name;
    this.description = options.description ?? "";
    this.systemPrompt = options.systemPrompt;
    this.llm = options.llm;
    this.toolList = options.tools ?? [];
    this.tools = new Map(this.toolList.map((tool) => [tool.name, tool]));
    this.maxSteps = options.maxSteps ?? 8;
    this.maxToolCalls = options.maxToolCalls ?? 12;
    this.model = options.model;
    this.temperature = options.temperature;
    this.statuses = options.statuses;
  }

  get toolNames(): string[] {
    return this.toolList.map((tool) => tool.name);
  }

  async run(input: string, context: AgentContext): Promise<AgentRunResult> {
    const { bus, logger, correlationId } = context;
    const started = Date.now();
    const source = `agent:${this.name}`;
    const activityId = `${correlationId}:agent:${this.name}`;
    let toolBudget = this.maxToolCalls;

    bus.publish(
      "agent.started",
      { agent: this.name, correlationId, input },
      { source, correlationId },
    );

    const messages: LlmMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: input },
    ];
    const steps: AgentStep[] = [];

    try {
      let finalText = "";

      for (let index = 0; index < this.maxSteps; index++) {
        const reasoning = this.statuses?.begin(activityId, "Reasoning", { correlationId });

        reasoning?.update("Waiting for the model");
        const completion = await this.llm.complete({
          messages,
          tools: this.toolList.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
          model: this.model,
          temperature: this.temperature,
          sessionId: correlationId,
        });
        reasoning?.done(
          completion.toolCalls.length > 0
            ? `Model requested ${completion.toolCalls.length} tool call(s)`
            : "Model answered",
        );

        if (completion.toolCalls.length === 0) {
          finalText = completion.text;
          steps.push({ index, text: completion.text, invocations: [], finishReason: completion.finishReason });
          break;
        }

        const invocations: AgentToolInvocation[] = [];
        messages.push({
          role: "assistant",
          content: completion.text,
          toolCalls: completion.toolCalls,
        });

        for (const call of completion.toolCalls) {
          if (toolBudget <= 0) {
            invocations.push({
              tool: call.name,
              args: call.arguments,
              error: "Tool budget exhausted. Produce the final notes with what you have.",
              durationMs: 0,
            });
            messages.push({
              role: "tool",
              toolCallId: call.id,
              content: serializeToolResult({
                tool: call.name,
                args: call.arguments,
                error: "Tool budget exhausted. Produce the final notes with what you have.",
                durationMs: 0,
              }),
            });
            continue;
          }
          toolBudget--;

          const invocation = await this.invokeTool(activityId, call.name, call.arguments, context);
          invocations.push(invocation);

          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: serializeToolResult(invocation),
          });
        }

        steps.push({
          index,
          text: completion.text,
          invocations,
          finishReason: completion.finishReason,
        });
      }

      if (!finalText) {
        finalText =
          steps.at(-1)?.text ||
          "The agent reached its step limit before producing a final answer.";
      }

      const result: AgentRunResult = {
        agent: this.name,
        text: finalText,
        steps,
        durationMs: Date.now() - started,
      };

      bus.publish(
        "agent.finished",
        {
          agent: this.name,
          correlationId,
          steps: steps.length,
          durationMs: result.durationMs,
          output: finalText.slice(0, 500),
        },
        { source, correlationId },
      );

      return result;
    } catch (error) {
      bus.publish(
        "agent.failed",
        { agent: this.name, correlationId, error: errorMessage(error) },
        { source, correlationId },
      );
      logger.error("agent failed", { error: errorMessage(error) });
      throw error;
    }
  }

  private async invokeTool(
    activityId: string,
    name: string,
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentToolInvocation> {
    const { bus, logger, correlationId } = context;
    const source = `agent:${this.name}`;
    const started = Date.now();

    bus.publish(
      "agent.tool.invoked",
      { agent: this.name, correlationId, tool: name, args },
      { source, correlationId },
    );

    const status = this.statuses?.begin(activityId, `Calling tool ${name}`, { correlationId });
    status?.update(`Waiting for ${name}`);

    const tool = this.tools.get(name);
    if (!tool) {
      const error = `Unknown tool "${name}"`;
      status?.failed(`Tool ${name} unknown`);
      bus.publish(
        "agent.tool.failed",
        { agent: this.name, correlationId, tool: name, error },
        { source, correlationId },
      );
      return { tool: name, args, error, durationMs: 0 };
    }

    try {
      const result = await tool.execute(args, { correlationId, bus, logger });
      const durationMs = Date.now() - started;
      const summary = summarizeResult(result);
      status?.done(`Tool ${name} returned (${summary})`);
      bus.publish(
        "agent.tool.succeeded",
        {
          agent: this.name,
          correlationId,
          tool: name,
          durationMs,
          summary,
        },
        { source, correlationId },
      );
      return { tool: name, args, result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = errorMessage(error);
      status?.failed(`Tool ${name} failed: ${message}`);
      bus.publish(
        "agent.tool.failed",
        { agent: this.name, correlationId, tool: name, error: message },
        { source, correlationId },
      );
      logger.warn("tool failed", { tool: name, error: message });
      return { tool: name, args, error: message, durationMs };
    }
  }
}

function serializeToolResult(invocation: AgentToolInvocation): string {
  const payload = invocation.error
    ? { error: invocation.error }
    : { result: invocation.result ?? null };
  const text = JSON.stringify(payload);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
}

function summarizeResult(result: unknown): string {
  if (result && typeof result === "object" && "results" in result) {
    const results = (result as { results: unknown[] }).results;
    return `${results.length} results`;
  }
  const text = JSON.stringify(result ?? null);
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}
