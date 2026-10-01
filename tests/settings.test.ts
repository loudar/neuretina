import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config/env.ts";
import { SettingsService } from "../src/config/settings.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import type { KeyValueStore } from "../src/domain/kv/KeyValueRepository.ts";

class MapKv implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

function setup(env: Record<string, string | undefined> = {}, kv = new MapKv()) {
  const config = loadConfig({});
  const service = new SettingsService({ kv, env, config });
  service.applyAll();
  return { kv, config, service };
}

const OPENAI_CONNECTION = {
  id: "openai-1",
  provider: "openai" as const,
  model: "gpt-5",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "sk-test",
};

describe("SettingsService", () => {
  test("falls back to the definition default when nothing overrides it", () => {
    const { config, service } = setup();

    const providers = service.list().find((setting) => setting.key === "LLM_PROVIDERS");
    expect(providers?.source).toBe("default");
    expect(providers?.value).toBeNull();
    expect(providers?.stored).toBe(false);
    expect(config.llmProviders).toEqual([]);
    expect(config.llmProvider).toBeUndefined();
  });

  test("database overrides apply when the environment is unset", () => {
    const { config, service } = setup();

    const info = service.set("LLM_PROVIDERS", JSON.stringify([OPENAI_CONNECTION]));
    expect(info.source).toBe("db");
    expect(info.stored).toBe(true);
    expect(config.llmProviders).toEqual([OPENAI_CONNECTION]);

    const selected = service.set("LLM_PROVIDER", OPENAI_CONNECTION.id);
    expect(selected.source).toBe("db");
    expect(config.llmProvider).toBe(OPENAI_CONNECTION.id);

    const listed = service.list().find((setting) => setting.key === "LLM_PROVIDERS");
    expect(listed?.source).toBe("db");
    expect(listed?.value).toBe(JSON.stringify([OPENAI_CONNECTION]));
  });

  test("user-owned settings ignore the environment", () => {
    const envProviders = [
      { id: "env-search", provider: "exa" as const, baseUrl: "https://api.exa.ai", apiKey: "env-key" },
    ];
    const { config, service } = setup({
      LLM_PROVIDERS: JSON.stringify([OPENAI_CONNECTION]),
      SEARCH_PROVIDERS: JSON.stringify(envProviders),
      BLUESKY_IDENTIFIER: "env-handle",
    });

    expect(service.list().find((setting) => setting.key === "LLM_PROVIDERS")?.source).toBe(
      "default",
    );
    expect(config.llmProviders).toEqual([]);
    expect(config.searchProviders).toEqual([]);
    expect(config.bluesky.identifier).toBeUndefined();

    // The user's own value still applies.
    const ownProviders = [
      { id: "own-search", provider: "perplexity" as const, baseUrl: "https://api.perplexity.ai", apiKey: "user-key" },
    ];
    service.set("SEARCH_PROVIDERS", JSON.stringify(ownProviders));
    expect(config.searchProviders).toEqual(ownProviders);
  });

  test("clearing an override restores the base value", () => {
    const { config, service } = setup();

    service.set("LLM_PROVIDER", "db-model");
    expect(config.llmProvider).toBe("db-model");

    const cleared = service.clear("LLM_PROVIDER");
    expect(cleared.source).toBe("default");
    expect(cleared.stored).toBe(false);
    expect(config.llmProvider).toBeUndefined();
  });

  test("secrets are applied and returned to the UI so the eye toggle can reveal them", () => {
    const { config, service } = setup();

    const info = service.set("QWEN_TTS_API_KEY", "top-secret-key");
    expect(info.value).toBe("top-secret-key");
    expect(info.configured).toBe(true);
    expect(info.stored).toBe(true);
    expect(config.qwenTts.apiKey).toBe("top-secret-key");

    // Connection secrets travel inside the JSON setting, revealable too.
    service.set("LLM_PROVIDERS", JSON.stringify([OPENAI_CONNECTION]));
    const providers = service.list().find((setting) => setting.key === "LLM_PROVIDERS");
    expect(providers?.value).toBe(JSON.stringify([OPENAI_CONNECTION]));
    expect(providers?.configured).toBe(true);
  });

  test("typed settings parse into the config", () => {
    const { config, service } = setup();

    service.set("QWEN_TTS_SPEED", "1.25");
    expect(config.qwenTts.speed).toBe(1.25);

    service.set("QWEN_TTS_FORMAT", "wav");
    expect(config.qwenTts.outputFormat).toBe("wav");

    service.set("TTS_PROVIDER", "elevenlabs");
    expect(config.tts.provider).toBe("elevenlabs");
  });

  test("rejects malformed values before storing them", () => {
    const { kv, service } = setup();

    expect(() => service.set("QWEN_TTS_SPEED", "many")).toThrow();
    expect(() => service.set("QWEN_TTS_FORMAT", "fortnight")).toThrow();
    expect(() => service.set("NOPE", "1")).toThrow();
    expect(() => service.set("LLM_PROVIDERS", "not json")).toThrow();
    expect(() =>
      service.set("LLM_PROVIDERS", JSON.stringify([{ id: "x", provider: "openai" }])),
    ).toThrow();
    expect(kv.get("setting:QWEN_TTS_SPEED")).toBeNull();
  });

  test("setting an empty value clears the override", () => {
    const { config, service } = setup();

    service.set("LLM_PROVIDER", "db-model");
    service.set("LLM_PROVIDER", "");
    expect(config.llmProvider).toBeUndefined();
    expect(service.list().find((setting) => setting.key === "LLM_PROVIDER")?.source).toBe(
      "default",
    );
  });

  test("exports stored overrides (secrets included) and imports them in one batch", () => {
    const { service } = setup();
    service.set("QWEN_TTS_SPEED", "1.5");
    service.set("LLM_PROVIDERS", JSON.stringify([OPENAI_CONNECTION]));

    const stored = service.exportStored();
    expect(stored).toEqual([
      { key: "LLM_PROVIDERS", value: JSON.stringify([OPENAI_CONNECTION]) },
      { key: "QWEN_TTS_SPEED", value: "1.5" },
    ]);

    const target = setup();
    let reloads = 0;
    target.service.onReload = () => reloads++;

    const applied = target.service.importStored([
      ...stored,
      { key: "NOPE", value: "ignored" },
      { key: "LLM_PROVIDERS", value: 42 },
      "not-an-entry",
    ]);

    expect(applied).toBe(2);
    expect(reloads).toBe(1);
    expect(target.service.exportStored()).toEqual(stored);
    expect(target.config.llmProviders).toEqual([OPENAI_CONNECTION]);
    expect(target.config.qwenTts.speed).toBe(1.5);
  });

  test("folds the legacy LLM settings into one connection", () => {
    const kv = new MapKv();
    kv.set("setting:OPENCODE_API_KEY", "legacy-key");
    kv.set("setting:LLM_BASE_URL", "https://legacy.example/v1");
    kv.set("setting:LLM_MODEL", "legacy-model");

    const { config } = setup({}, kv);

    expect(config.llmProviders).toHaveLength(1);
    expect(config.llmProviders[0]).toMatchObject({
      provider: "opencode",
      baseUrl: "https://legacy.example/v1",
      model: "legacy-model",
      apiKey: "legacy-key",
    });
    expect(config.llmProvider).toBe(config.llmProviders[0]!.id);
    expect(kv.get("setting:LLM_MODEL")).toBeNull();
    expect(kv.get("setting:OPENCODE_API_KEY")).toBeNull();
  });

  test("emits a value-free settings.updated event and reloads providers", () => {
    const bus = new EventBus(new EventStore(new SqliteDatabase(":memory:")), createLogger("test", { level: "error" }));
    const config = loadConfig({});
    const service = new SettingsService({ kv: new MapKv(), env: {}, config, bus });
    service.applyAll();

    let reloads = 0;
    service.onReload = () => reloads++;

    service.set("LLM_PROVIDERS", JSON.stringify([OPENAI_CONNECTION]));
    service.clear("LLM_PROVIDERS");

    expect(reloads).toBe(2);

    const events = bus.replayAfter(0).filter((event) => event.topic === "settings.updated");
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({ key: "LLM_PROVIDERS", action: "set" });
    expect(events[1]?.payload).toEqual({ key: "LLM_PROVIDERS", action: "cleared" });
    expect(JSON.stringify(events)).not.toContain("sk-test");
  });
});
