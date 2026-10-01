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

describe("SettingsService", () => {
  test("falls back to the definition default when nothing overrides it", () => {
    const { config, service } = setup();

    const model = service.list().find((setting) => setting.key === "LLM_MODEL");
    expect(model?.source).toBe("default");
    expect(model?.value).toBe("deepseek-v4.1-flash");
    expect(model?.stored).toBe(false);
    expect(config.llm.model).toBe("deepseek-v4.1-flash");
  });

  test("database overrides apply when the environment is unset", () => {
    const { config, service } = setup();

    const info = service.set("LLM_MODEL", "db-model");
    expect(info.source).toBe("db");
    expect(info.value).toBe("db-model");
    expect(info.stored).toBe(true);
    expect(config.llm.model).toBe("db-model");

    const listed = service.list().find((setting) => setting.key === "LLM_MODEL");
    expect(listed?.source).toBe("db");
    expect(listed?.value).toBe("db-model");
  });

  test("the environment always wins over the database", () => {
    const kv = new MapKv();
    kv.set("setting:DEFAULT_BRIEF_LANGUAGE", "db-lang");
    const { config, service } = setup({ DEFAULT_BRIEF_LANGUAGE: "env-lang" }, kv);

    const info = service.list().find((setting) => setting.key === "DEFAULT_BRIEF_LANGUAGE");
    expect(info?.source).toBe("env");
    expect(info?.value).toBe("env-lang");
    expect(info?.stored).toBe(true);
    expect(config.defaults.briefLanguage).toBe("env-lang");

    // Storing another override changes nothing while the env var is set.
    expect(service.set("DEFAULT_BRIEF_LANGUAGE", "other-db").source).toBe("env");
    expect(config.defaults.briefLanguage).toBe("env-lang");
  });

  test("user-owned settings ignore the environment", () => {
    const { config, service } = setup({
      LLM_MODEL: "env-model",
      KEY_PERPLEXITY: "env-key",
      BLUESKY_IDENTIFIER: "env-handle",
    });

    expect(service.list().find((setting) => setting.key === "LLM_MODEL")?.source).toBe(
      "default",
    );
    expect(config.llm.model).toBe("deepseek-v4.1-flash");
    expect(config.perplexity.apiKey).toBeUndefined();
    expect(config.bluesky.identifier).toBeUndefined();

    // The user's own value still applies.
    service.set("KEY_PERPLEXITY", "user-key");
    expect(config.perplexity.apiKey).toBe("user-key");
  });

  test("clearing an override restores the base value", () => {
    const { config, service } = setup();

    service.set("LLM_MODEL", "db-model");
    expect(config.llm.model).toBe("db-model");

    const cleared = service.clear("LLM_MODEL");
    expect(cleared.source).toBe("default");
    expect(cleared.stored).toBe(false);
    expect(config.llm.model).toBe("deepseek-v4.1-flash");
  });

  test("secrets are applied but never returned to the UI", () => {
    const { config, service } = setup();

    const info = service.set("LLM_API_KEY", "top-secret-key");
    expect(info.value).toBeNull();
    expect(info.configured).toBe(true);
    expect(info.stored).toBe(true);
    expect(config.llm.apiKey).toBe("top-secret-key");

    const listed = service.list().find((setting) => setting.key === "LLM_API_KEY");
    expect(listed?.value).toBeNull();
    expect(listed?.configured).toBe(true);
  });

  test("typed settings parse into the config", () => {
    const { config, service } = setup();

    service.set("DEFAULT_SEARCH_RESULTS", "12");
    expect(config.defaults.searchResultsPerProvider).toBe(12);

    service.set("DEFAULT_FOLLOWUP_RESEARCH", "false");
    expect(config.defaults.followups).toBe(false);

    service.set("DEFAULT_SEARCH_RECENCY", "week");
    expect(config.defaults.searchRecency).toBe("week");

    service.set("QWEN_TTS_SPEED", "1.25");
    expect(config.qwenTts.speed).toBe(1.25);

    service.set("DEFAULT_SEARCH_DOMAINS", "off");
    expect(config.defaults.searchDomains).toEqual([]);
  });

  test("rejects malformed values before storing them", () => {
    const { kv, service } = setup();

    expect(() => service.set("DEFAULT_SEARCH_RESULTS", "many")).toThrow();
    expect(() => service.set("DEFAULT_SEARCH_RECENCY", "fortnight")).toThrow();
    expect(() => service.set("NOPE", "1")).toThrow();
    expect(kv.get("setting:DEFAULT_SEARCH_RESULTS")).toBeNull();
  });

  test("setting an empty value clears the override", () => {
    const { config, service } = setup();

    service.set("LLM_MODEL", "db-model");
    service.set("LLM_MODEL", "");
    expect(config.llm.model).toBe("deepseek-v4.1-flash");
    expect(service.list().find((setting) => setting.key === "LLM_MODEL")?.source).toBe("default");
  });

  test("emits a value-free settings.updated event and reloads providers", () => {
    const bus = new EventBus(new EventStore(new SqliteDatabase(":memory:")), createLogger("test", { level: "error" }));
    const config = loadConfig({});
    const service = new SettingsService({ kv: new MapKv(), env: {}, config, bus });
    service.applyAll();

    let reloads = 0;
    service.onReload = () => reloads++;

    service.set("LLM_API_KEY", "top-secret");
    service.clear("LLM_API_KEY");

    expect(reloads).toBe(2);

    const events = bus.replayAfter(0).filter((event) => event.topic === "settings.updated");
    expect(events).toHaveLength(2);
    expect(events[0]?.payload).toEqual({ key: "LLM_API_KEY", action: "set" });
    expect(events[1]?.payload).toEqual({ key: "LLM_API_KEY", action: "cleared" });
    expect(JSON.stringify(events)).not.toContain("top-secret");
  });
});
