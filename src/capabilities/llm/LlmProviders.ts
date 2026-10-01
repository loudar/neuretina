/**
 * LLM connections. Every provider exposes an OpenAI-compatible chat
 * completions API, so one generic connection shape covers all; the presets
 * only prefill endpoints, model names and labels. One connection is one
 * provider+model pairing, and the active-connection setting picks which runs.
 */
export type LlmProviderId = "opencode" | "openai" | "openrouter" | "ollama";

export interface LlmConnection {
  id: string;
  provider: LlmProviderId;
  /** Model sent with every completion. */
  model: string;
  baseUrl: string;
  apiKey?: string;
}

export interface LlmProviderPreset {
  /** Display name of the provider, e.g. "OpenAI". */
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Model names the provider ships; the form offers these. */
  models: string[];
  /** Set false for keyless providers (local servers). */
  apiKey?: boolean;
  /** Label for the endpoint field; defaults to "API base URL". */
  endpointLabel?: string;
}

export const LLM_PROVIDER_PRESETS: Record<LlmProviderId, LlmProviderPreset> = {
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

/** "{provider} - {model}", e.g. "OpenAI - gpt-5". */
export function llmProviderLabel(connection: LlmConnection): string {
  return `${LLM_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider} - ${connection.model}`;
}

/** The connection the engine runs on: the selected id, else the first. */
export function activeLlmConnection(
  connections: LlmConnection[],
  selected?: string,
): LlmConnection | undefined {
  const list = Array.isArray(connections) ? connections : [];
  return list.find((connection) => connection.id === selected) ?? list[0];
}

/** Whether the connection carries what its provider needs (keys optional). */
export function isLlmConnectionConfigured(connection: LlmConnection | undefined): boolean {
  if (!connection) return false;
  return LLM_PROVIDER_PRESETS[connection.provider]?.apiKey === false || Boolean(connection.apiKey);
}

/** Shape check for values coming from settings or imported bundles. */
export function isLlmConnection(value: unknown): value is LlmConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.provider !== "string") return false;
  if (!LLM_PROVIDER_PRESETS[record.provider as LlmProviderId]) return false;
  if (typeof record.model !== "string" || !record.model.trim()) return false;
  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) return false;
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") return false;
  return true;
}

/** Parses a stored connection list; undefined when the value is not one. */
export function parseLlmConnections(value: unknown): LlmConnection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const connections: LlmConnection[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isLlmConnection(entry) || seen.has(entry.id.trim())) return undefined;
    seen.add(entry.id.trim());
    connections.push({
      id: entry.id.trim(),
      provider: entry.provider,
      model: entry.model.trim(),
      baseUrl: entry.baseUrl.trim(),
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    });
  }
  return connections;
}
