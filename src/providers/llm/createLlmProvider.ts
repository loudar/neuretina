import {
  LLM_PROVIDER_PRESETS,
  type LlmConnection,
} from "../../capabilities/llm/LlmProviders.ts";
import { OpenAiCompatibleLlmProvider } from "./OpenAiCompatibleLlmProvider.ts";

/** Builds the OpenAI-compatible provider for one LLM connection. */
export function createLlmProvider(
  connection: LlmConnection,
  sessionId: string,
): OpenAiCompatibleLlmProvider {
  const preset = LLM_PROVIDER_PRESETS[connection.provider];
  return new OpenAiCompatibleLlmProvider({
    ...(connection.apiKey ? { apiKey: connection.apiKey } : {}),
    baseUrl: connection.baseUrl,
    defaultModel: connection.model,
    sessionId,
    ...(preset?.apiKey === false ? { apiKeyRequired: false } : {}),
  });
}
