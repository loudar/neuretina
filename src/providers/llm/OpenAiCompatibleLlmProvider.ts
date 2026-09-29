import OpenAI from "openai";
import { ConfigurationError, ProviderError } from "../../core/errors.ts";
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
  private readonly client: OpenAI | null;

  constructor(options: OpenAiCompatibleLlmOptions) {
    this.name = options.name ?? "openai-compatible";
    this.defaultModel = options.defaultModel;
    this.apiKey = options.apiKey;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.userAgent = options.userAgent ?? APP_USER_AGENT;
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

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    if (!this.client) {
      throw new ConfigurationError(
        "LLM provider is not configured. Set OPENCODE_API_KEY to a valid OpenCode Go API key.",
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
            "x-opencode-session": request.sessionId ?? this.sessionId,
            "user-agent": this.userAgent,
          },
        },
      );

      const choice = completion.choices[0];
      const message = choice?.message;

      return {
        text: message?.content ?? "",
        toolCalls: (message?.tool_calls ?? [])
          .filter((call) => call.type === "function")
          .map(parseToolCall),
        finishReason: choice?.finish_reason ?? "stop",
        model: completion.model,
        usage: {
          inputTokens: completion.usage?.prompt_tokens,
          outputTokens: completion.usage?.completion_tokens,
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
