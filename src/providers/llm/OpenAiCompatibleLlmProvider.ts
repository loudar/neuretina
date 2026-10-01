import OpenAI from "openai";
import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import { finiteNumber, numberField } from "../../core/records.ts";
import { requestJson } from "../../infra/http/request.ts";
import { APP_USER_AGENT } from "../../version.ts";
import type {
  LlmCompletionRequest,
  LlmCompletionResult,
  LlmMessage,
  LlmProvider,
  LlmToolCall,
} from "../../capabilities/llm/LlmProvider.ts";

export interface OpenAiCompatibleLlmOptions {
  apiKey?: string;
  baseUrl: string;
  defaultModel: string;
  name?: string;
  timeoutMs?: number;
  sessionId?: string;
  userAgent?: string;
}

export class OpenAiCompatibleLlmProvider implements LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  readonly sessionId: string;
  readonly userAgent: string;

  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly client: OpenAI | null;
  /** OpenCode endpoints require their routing/session header; others don't. */
  private readonly openCode: boolean;

  constructor(options: OpenAiCompatibleLlmOptions) {
    this.name = options.name ?? "openai-compatible";
    this.defaultModel = options.defaultModel;
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.userAgent = options.userAgent ?? APP_USER_AGENT;
    this.openCode = isOpenCodeEndpoint(options.baseUrl);
    this.client = options.apiKey
      ? new OpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseUrl,
          timeout: options.timeoutMs ?? 120_000,
        })
      : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  /** Verifies the key/endpoint without spending tokens on a completion. */
  async verify(): Promise<string> {
    if (!this.apiKey) {
      throw new ConfigurationError(
        "LLM provider is not configured. Add an API key for your OpenAI-compatible endpoint in Settings.",
      );
    }

    const response = await requestJson<{ data?: unknown[] }>(
      this.name,
      `${this.baseUrl.replace(/\/$/, "")}/models`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.openCode ? { "x-opencode-session": this.sessionId } : {}),
          "user-agent": this.userAgent,
        },
      },
    );

    const models = Array.isArray(response.data) ? response.data.length : undefined;
    return models !== undefined ? `reachable, ${models} models` : "reachable";
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new ConfigurationError(
        "LLM provider is not configured. Add an API key for your OpenAI-compatible endpoint in Settings.",
      );
    }

    try {
      const completion = await this.client.chat.completions.create(
        {
          model: request.model ?? this.defaultModel,
          messages: request.messages.map(toOpenAiMessage),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function" as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
          ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
          ...(request.responseFormat === "json"
            ? { response_format: { type: "json_object" as const } }
            : {}),
        },
        {
          headers: {
            ...(this.openCode ? { "x-opencode-session": request.sessionId ?? this.sessionId } : {}),
            "user-agent": this.userAgent,
          },
          ...(request.signal ? { signal: request.signal } : {}),
        },
      );

      const choice = completion.choices[0];
      const message = choice?.message;
      const usageRecord = completion.usage as unknown;
      const costUsd = costOf(usageRecord);
      const inputTokens =
        numericField(usageRecord, "prompt_tokens") ?? numericField(usageRecord, "input_tokens");
      const outputTokens =
        numericField(usageRecord, "completion_tokens") ?? numericField(usageRecord, "output_tokens");

      return {
        text: message?.content ?? "",
        toolCalls: (message?.tool_calls ?? [])
          .filter((call) => call.type === "function")
          .map(parseToolCall),
        finishReason: choice?.finish_reason ?? "stop",
        model: completion.model,
        usage: {
          ...(inputTokens !== undefined ? { inputTokens } : {}),
          ...(outputTokens !== undefined ? { outputTokens } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        },
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new ProviderError(this.name, `LLM request failed: ${error.message}`, {
          status: error.status,
          cause: error,
        });
      }
      throw new ProviderError(this.name, `LLM request failed: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }
}

function numericField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  return numberField(value as Record<string, unknown>, key);
}

/** OpenCode's gateway (opencode.ai / opencode.com and subdomains). */
function isOpenCodeEndpoint(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === "opencode.ai" || host.endsWith(".opencode.ai") ||
      host === "opencode.com" || host.endsWith(".opencode.com");
  } catch {
    return false;
  }
}

function costOf(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const nested =
    record.cost && typeof record.cost === "object"
      ? (record.cost as Record<string, unknown>).total_cost
      : undefined;
  for (const value of [record.cost, record.total_cost, nested]) {
    const usd = finiteNumber(value);
    if (usd !== undefined) return usd;
  }
  return undefined;
}

function parseToolCall(call: { id: string; function: { name: string; arguments: string } }): LlmToolCall {
  let args: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object") args = parsed as Record<string, unknown>;
  } catch {
    args = {};
  }
  return { id: call.id, name: call.function.name, arguments: args };
}

function toOpenAiMessage(message: LlmMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function" as const,
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }

  return {
    role: message.role,
    content: message.content,
  };
}
