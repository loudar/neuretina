import {
  activeConnection,
  connectionLabel,
  isConnection,
  parseConnections,
  type Connection,
  type ConnectionPreset,
} from "../connections.ts";

/**
 * Every LLM provider exposes an OpenAI-compatible chat completions API, so
 * one connection is one provider+model pairing; the active-connection setting
 * picks which runs.
 */
export type LlmProviderId = "opencode" | "openai" | "openrouter" | "ollama";

export interface LlmConnection extends Connection {
  provider: LlmProviderId;
  model: string;
}

export const LLM_PROVIDER_PRESETS: Record<
  LlmProviderId,
  ConnectionPreset & { defaultModel: string }
> = {
  opencode: {
    label: "OpenCode",
    defaultBaseUrl: "https://opencode.ai/zen/go/v1",
    defaultModel: "deepseek-v4.1-flash",
    models: ["deepseek-v4.1-flash"],
  },
  openai: {
    label: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5",
    models: ["gpt-5", "gpt-5-mini"],
  },
  openrouter: {
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "deepseek/deepseek-v4.1-flash",
    models: ["deepseek/deepseek-v4.1-flash"],
  },
  ollama: {
    label: "Ollama",
    defaultBaseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.3",
    models: ["llama3.3"],
    apiKey: false,
  },
};

export const LLM_PROVIDER_IDS = Object.keys(LLM_PROVIDER_PRESETS) as LlmProviderId[];

/** The OpenCode pairing the engine falls back to while unconfigured. */
export const DEFAULT_LLM_CONNECTION: LlmConnection = {
  id: "default",
  provider: "opencode",
  baseUrl: LLM_PROVIDER_PRESETS.opencode.defaultBaseUrl,
  model: LLM_PROVIDER_PRESETS.opencode.defaultModel,
};

export function llmProviderLabel(connection: LlmConnection): string {
  return connectionLabel(connection, LLM_PROVIDER_PRESETS);
}

export function activeLlmConnection(
  connections: LlmConnection[],
  selected?: string,
): LlmConnection | undefined {
  return activeConnection(connections, selected);
}

/** Whether the connection carries what its provider needs (keys optional). */
export function isLlmConnectionConfigured(connection: LlmConnection | undefined): boolean {
  if (!connection) return false;
  return LLM_PROVIDER_PRESETS[connection.provider]?.apiKey === false || Boolean(connection.apiKey);
}

export function isLlmConnection(value: unknown): value is LlmConnection {
  return isConnection(value, LLM_PROVIDER_PRESETS);
}

export function parseLlmConnections(value: unknown): LlmConnection[] | undefined {
  return parseConnections<LlmConnection>(value, LLM_PROVIDER_PRESETS, "id");
}
