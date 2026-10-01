/**
 * Connectivity check for the active LLM connection: sends one tiny chat
 * completion. Usage: `bun run check:llm`
 */
import {
  activeLlmConnection,
  isLlmConnectionConfigured,
  llmProviderLabel,
} from "../src/capabilities/llm/LlmProviders.ts";
import { loadConfig } from "../src/config/env.ts";
import { SettingsService } from "../src/config/settings.ts";
import { KeyValueRepository } from "../src/domain/kv/KeyValueRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createLlmProvider } from "../src/providers/llm/createLlmProvider.ts";

const config = loadConfig();
const db = new SqliteDatabase(config.dbPath);
const settings = new SettingsService({
  kv: new KeyValueRepository(db),
  env: Bun.env,
  config,
});
settings.applyAll();

const connection = activeLlmConnection(config.llmProviders, config.llmProvider);
if (!connection || !isLlmConnectionConfigured(connection)) {
  console.error("No LLM provider configured (Settings → LLM)");
  process.exit(1);
}

console.log(`checking ${llmProviderLabel(connection)} at ${connection.baseUrl}`);
const provider = createLlmProvider(connection, "llm-check");

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
} finally {
  db.close();
}
