/**
 * Connectivity check for the configured Qwen3-TTS server: verifies the
 * endpoint and synthesizes one short sentence. Usage: `bun run check:tts`
 */
import { loadConfig } from "../src/config/env.ts";
import { QwenTtsProvider } from "../src/providers/tts/QwenTtsProvider.ts";

const config = loadConfig();
if (!config.qwenTts.baseUrl) {
  console.error("QWEN_TTS_BASE_URL is not set (see .env.example)");
  process.exit(1);
}

const provider = new QwenTtsProvider({
  baseUrl: config.qwenTts.baseUrl,
  model: config.qwenTts.model,
  voiceId: config.qwenTts.voiceId,
  outputFormat: config.qwenTts.outputFormat,
  language: config.qwenTts.language,
  speed: config.qwenTts.speed,
  apiKey: config.qwenTts.apiKey,
  timeoutMs: config.qwenTts.timeoutMs,
});

try {
  const started = Date.now();
  const detail = await provider.verify();
  console.log(`verified: ${detail}`);
} catch (error) {
  console.error(`verify failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

try {
  const started = Date.now();
  const speech = await provider.synthesize({
    text: "The briefing engine speech check is running.",
  });
  const seconds = speech.durationMs ? `, ${(speech.durationMs / 1000).toFixed(1)}s audio` : "";
  console.log(
    `ok: ${(speech.data.byteLength / 1024).toFixed(0)} KB ${speech.mimeType} in ${Date.now() - started}ms${seconds}`,
  );
} catch (error) {
  console.error(`failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
