export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface LlmMessage {
  role: LlmRole;
  content: string;
  toolCallId?: string;
  toolCalls?: LlmToolCall[];
}

export interface LlmToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmCompletionRequest {
  messages: LlmMessage[];
  tools?: LlmToolSchema[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: "text" | "json";
  sessionId?: string;
  /** Aborts the in-flight request when the owning run is cancelled. */
  signal?: AbortSignal;
}

export interface LlmUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Exact cost in USD when the gateway reports one. */
  costUsd?: number;
}

export interface LlmCompletionResult {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: string;
  model: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  readonly defaultModel: string;
  complete(request: LlmCompletionRequest): Promise<LlmCompletionResult>;
}
