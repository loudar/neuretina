import type { Logger } from "../core/logger.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { LlmMessage, LlmProvider, LlmUsage } from "../capabilities/llm/LlmProvider.ts";
import { errorMessage } from "../core/errors.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import { invokeTool } from "./toolInvocation.ts";
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
}

export interface AgentContext {
  correlationId: string;
  bus: EventBus;
  logger: Logger;
  /** Aborted when the owning run is cancelled; checked between LLM steps. */
  signal?: AbortSignal;
  /** Activity hub: every tool call becomes a child span under `statusId`. */
  statuses?: StatusHub;
  /** Step span the agent's tool calls belong to. */
  statusId?: string;
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
  /** Token/cost usage summed across every LLM completion of the run. */
  usage: LlmUsage;
}

const MAX_TOOL_RESULT_CHARS = 8000;

/** Used when the loop ends without the model producing a final answer. */
export const AGENT_STEP_LIMIT_MESSAGE =
  "The agent reached its step limit before producing a final answer.";

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
  }

  get toolNames(): string[] {
    return this.toolList.map((tool) => tool.name);
  }

  async run(input: string, context: AgentContext): Promise<AgentRunResult> {
    const { bus, logger, correlationId } = context;
    const started = Date.now();
    const source = `agent:${this.name}`;
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
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let costUsd: number | undefined;

      for (let index = 0; index < this.maxSteps; index++) {
        context.signal?.throwIfAborted();

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
          signal: context.signal,
        });

        inputTokens = accumulate(inputTokens, completion.usage.inputTokens);
        outputTokens = accumulate(outputTokens, completion.usage.outputTokens);
        costUsd = accumulate(costUsd, completion.usage.costUsd);

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

          const invocation = await this.invokeTool(call.name, call.arguments, context);
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
        finalText = steps.at(-1)?.text || AGENT_STEP_LIMIT_MESSAGE;
      }

      const usage: LlmUsage = {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(costUsd !== undefined ? { costUsd } : {}),
      };

      const result: AgentRunResult = {
        agent: this.name,
        text: finalText,
        steps,
        durationMs: Date.now() - started,
        usage,
      };

      bus.publish(
        "agent.finished",
        {
          agent: this.name,
          correlationId,
          steps: steps.length,
          durationMs: result.durationMs,
          output: finalText.slice(0, 500),
          usage,
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
    name: string,
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<AgentToolInvocation> {
    const outcome = await invokeTool(this.tools.get(name), name, args, {
      agent: this.name,
      source: `agent:${this.name}`,
      correlationId: context.correlationId,
      bus: context.bus,
      logger: context.logger,
      ...(context.statuses ? { statuses: context.statuses } : {}),
      ...(context.statusId ? { statusId: context.statusId } : {}),
    });

    if (outcome.error !== undefined) {
      context.logger.warn("tool failed", { tool: name, error: outcome.error });
    }

    return {
      tool: name,
      args,
      ...(outcome.result !== undefined ? { result: outcome.result } : {}),
      ...(outcome.error !== undefined ? { error: outcome.error } : {}),
      durationMs: outcome.durationMs,
    };
  }
}

function accumulate(current: number | undefined, next: number | undefined): number | undefined {
  if (next === undefined) return current;
  return (current ?? 0) + next;
}

function serializeToolResult(invocation: AgentToolInvocation): string {
  const payload = invocation.error
    ? { error: invocation.error }
    : { result: invocation.result ?? null };
  const text = JSON.stringify(payload);
  if (text.length <= MAX_TOOL_RESULT_CHARS) return text;
  return `${text.slice(0, MAX_TOOL_RESULT_CHARS)}…[truncated]`;
}


