/**
 * Connectivity check for the configured LLM (OpenCode Go): sends one tiny
 * chat completion. Usage: `bun run check:llm`
 */
import { loadConfig } from "../src/config/env.ts";
import { OpenAiCompatibleLlmProvider } from "../src/providers/llm/OpenAiCompatibleLlmProvider.ts";

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error("OPENCODE_API_KEY is not set (see .env.example)");
  process.exit(1);
}

const provider = new OpenAiCompatibleLlmProvider({
  apiKey: config.llm.apiKey,
  baseUrl: config.llm.baseUrl,
  defaultModel: config.llm.model,
  name: "opencode-go",
  sessionId: config.llm.sessionId,
});

const started = Date.now();
try {
  const result = await provider.complete({
    messages: [{ role: "user", content: "Reply with the single word: OK" }],
    maxTokens: 512,
    sessionId: "llm-check",
  });
  console.log(
    `ok: ${result.model} replied ${JSON.stringify(result.text.trim())} in ${Date.now() - started}ms`,
  );
} catch (error) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
