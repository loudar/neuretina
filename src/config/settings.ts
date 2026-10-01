import type { SearchRecency } from "../capabilities/search/SearchProvider.ts";
import { ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { KeyValueStore } from "../domain/kv/KeyValueRepository.ts";
import type { AppConfig, Env } from "./env.ts";
import { DEFAULT_SEARCH_DOMAINS } from "./env.ts";

export type SettingKind = "string" | "secret" | "number" | "boolean" | "list" | "enum";
export type SettingSource = "env" | "db" | "default";

export interface SettingDefinition {
  /** Environment variable name; also the key used for the database override. */
  key: string;
  group: string;
  label: string;
  description?: string;
  kind: SettingKind;
  /** Allowed values for `enum` settings. */
  options?: string[];
  /** Value used when neither the environment nor the database provides one. */
  default?: string;
  /** User-owned setting: the deployment environment cannot set it. */
  userOnly?: boolean;
  apply(config: AppConfig, value: string | undefined): void;
}

export interface SettingInfo {
  key: string;
  group: string;
  label: string;
  description?: string;
  kind: SettingKind;
  options?: string[];
  defaultValue?: string;
  /** Where the effective value comes from; `env` always wins. */
  source: SettingSource;
  /** Effective value; `null` for secret settings, which are never sent to the UI. */
  value: string | null;
  /** Whether an effective value exists (secrets included). */
  configured: boolean;
  /** Whether a database override is stored (even when the environment shadows it). */
  stored: boolean;
}

export interface SettingsServiceOptions {
  kv: KeyValueStore;
  env: Env;
  config: AppConfig;
  bus?: EventBus;
}

const DB_PREFIX = "setting:";

function optional(value: string | undefined): string | undefined {
  return value && value.trim() ? value : undefined;
}

function toNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBool(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  return !["false", "0", "no", "off"].includes(value.trim().toLowerCase());
}

/** Same semantics as `parseSearchDomains`: `off` disables, at most 20 entries. */
function toSearchDomains(value: string | undefined): string[] {
  if (!value) return [...DEFAULT_SEARCH_DOMAINS];
  if (["off", "none", "false", "0"].includes(value.trim().toLowerCase())) return [];
  return value
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  {
    key: "LLM_API_KEY",
    group: "LLM",
    label: "API key",
    description:
      "Key for your OpenAI-compatible endpoint (OpenCode Go, OpenAI, a local vLLM, etc). OpenCode endpoints get their session header automatically.",
    kind: "secret",
    userOnly: true,
    apply: (config, value) => {
      config.llm.apiKey = optional(value);
    },
  },
  {
    key: "LLM_BASE_URL",
    group: "LLM",
    label: "Base URL",
    description: "OpenAI-compatible endpoint, e.g. https://opencode.ai/zen/go/v1 or https://api.openai.com/v1.",
    kind: "string",
    default: "https://opencode.ai/zen/go/v1",
    userOnly: true,
    apply: (config, value) => {
      config.llm.baseUrl = optional(value) ?? "https://opencode.ai/zen/go/v1";
    },
  },
  {
    key: "LLM_MODEL",
    group: "LLM",
    label: "Model",
    kind: "string",
    default: "deepseek-v4.1-flash",
    userOnly: true,
    apply: (config, value) => {
      config.llm.model = optional(value) ?? "deepseek-v4.1-flash";
    },
  },

  {
    key: "KEY_PERPLEXITY",
    group: "Web search & finance (Perplexity)",
    label: "API key",
    description: "Used for web search and the finance lookup tool.",
    kind: "secret",
    userOnly: true,
    apply: (config, value) => {
      config.perplexity.apiKey = optional(value);
    },
  },
  {
    key: "PERPLEXITY_BASE_URL",
    group: "Web search & finance (Perplexity)",
    label: "Base URL",
    kind: "string",
    default: "https://api.perplexity.ai",
    userOnly: true,
    apply: (config, value) => {
      config.perplexity.baseUrl = optional(value) ?? "https://api.perplexity.ai";
    },
  },
  {
    key: "PERPLEXITY_FINANCE_MODEL",
    group: "Web search & finance (Perplexity)",
    label: "Finance model",
    description: "Model the Agent API routes finance_search lookups to.",
    kind: "string",
    default: "perplexity/glm-5.3-flash",
    userOnly: true,
    apply: (config, value) => {
      config.perplexity.financeModel = optional(value) ?? "perplexity/glm-5.3-flash";
    },
  },
  {
    key: "KEY_EXA",
    group: "Web search (Exa)",
    label: "API key",
    description: "Adds a second web search tool (search.exa) for neural and keyword search.",
    kind: "secret",
    userOnly: true,
    apply: (config, value) => {
      config.exa.apiKey = optional(value);
    },
  },
  {
    key: "EXA_BASE_URL",
    group: "Web search (Exa)",
    label: "Base URL",
    kind: "string",
    default: "https://api.exa.ai",
    userOnly: true,
    apply: (config, value) => {
      config.exa.baseUrl = optional(value) ?? "https://api.exa.ai";
    },
  },

  {
    key: "TTS_PROVIDER",
    group: "Speech",
    label: "Provider",
    description:
      "Both providers speak the same TTS protocol; pick which one synthesizes voice messages.",
    kind: "enum",
    options: ["qwen", "elevenlabs"],
    default: "qwen",
    userOnly: true,
    apply: (config, value) => {
      config.tts.provider = value === "elevenlabs" ? "elevenlabs" : "qwen";
    },
  },

  {
    key: "QWEN_TTS_BASE_URL",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Base URL",
    description:
      "Local OpenAI-compatible TTS server including /v1, e.g. http://127.0.0.1:8880/v1. Speech is skipped when empty.",
    kind: "string",
    apply: (config, value) => {
      config.qwenTts.baseUrl = value ?? "";
    },
  },
  {
    key: "QWEN_TTS_MODEL",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Model",
    description: "Most local servers accept and ignore the model name.",
    kind: "string",
    default: "tts-1",
    apply: (config, value) => {
      config.qwenTts.model = optional(value) ?? "tts-1";
    },
  },
  {
    key: "QWEN_TTS_VOICE",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Voice",
    description: "Preset speaker (Ryan, vivian, etc) or an OpenAI alias (alloy, nova, etc).",
    kind: "string",
    default: "Ryan",
    apply: (config, value) => {
      config.qwenTts.voiceId = optional(value) ?? "Ryan";
    },
  },
  {
    key: "QWEN_TTS_FORMAT",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Output format",
    description: "opus renders as a voice message; wav/mp3/flac/aac/pcm also work.",
    kind: "enum",
    options: ["opus", "wav", "mp3", "flac", "aac", "pcm"],
    default: "opus",
    apply: (config, value) => {
      config.qwenTts.outputFormat = optional(value) ?? "opus";
    },
  },
  {
    key: "QWEN_TTS_REQUEST_FORMAT",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Server request format",
    description:
      "What to ask the server for. Set wav for strict GGML servers that reject opus; the engine converts the response to the output format locally with ffmpeg. Empty asks for the output format directly.",
    kind: "enum",
    options: ["opus", "wav", "mp3", "flac", "aac", "pcm"],
    apply: (config, value) => {
      config.qwenTts.requestFormat = optional(value);
    },
  },
  {
    key: "QWEN_TTS_SPEED",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Speed",
    kind: "number",
    default: "1",
    apply: (config, value) => {
      config.qwenTts.speed = toNumber(value, 1);
    },
  },
  {
    key: "QWEN_TTS_LANGUAGE",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Language",
    description: "Optional language hint for multilingual servers, e.g. English.",
    kind: "string",
    apply: (config, value) => {
      config.qwenTts.language = optional(value);
    },
  },
  {
    key: "QWEN_TTS_API_KEY",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "API key",
    description: "Only needed when the local server enforces auth.",
    kind: "secret",
    apply: (config, value) => {
      config.qwenTts.apiKey = optional(value);
    },
  },
  {
    key: "QWEN_TTS_TIMEOUT_MS",
    userOnly: true,
    group: "Speech (Qwen3-TTS)",
    label: "Synthesis timeout (ms)",
    description:
      "Per-attempt limit for one synthesis request. CPU inference needs minutes per brief; GPU servers answer in seconds.",
    kind: "number",
    default: "600000",
    apply: (config, value) => {
      config.qwenTts.timeoutMs = toNumber(value, 600_000);
    },
  },

  {
    key: "KEY_ELEVENLABS",
    group: "Speech (ElevenLabs)",
    label: "API key",
    kind: "secret",
    userOnly: true,
    apply: (config, value) => {
      config.elevenlabs.apiKey = optional(value);
    },
  },
  {
    key: "ELEVENLABS_VOICE_ID",
    group: "Speech (ElevenLabs)",
    label: "Voice id",
    kind: "string",
    default: "JBFqnCBsd6RMkjVDRZzb",
    userOnly: true,
    apply: (config, value) => {
      config.elevenlabs.voiceId = optional(value) ?? "JBFqnCBsd6RMkjVDRZzb";
    },
  },
  {
    key: "ELEVENLABS_MODEL_ID",
    group: "Speech (ElevenLabs)",
    label: "Model",
    kind: "string",
    default: "eleven_v4",
    userOnly: true,
    apply: (config, value) => {
      config.elevenlabs.modelId = optional(value) ?? "eleven_v4";
    },
  },
  {
    key: "ELEVENLABS_SPEED",
    group: "Speech (ElevenLabs)",
    label: "Speed",
    kind: "number",
    default: "1.15",
    userOnly: true,
    apply: (config, value) => {
      config.elevenlabs.speed = toNumber(value, 1.15);
    },
  },

  {
    key: "BLUESKY_IDENTIFIER",
    group: "Bluesky",
    label: "Handle",
    description: "Account handle used to authenticate search (recommended).",
    kind: "string",
    userOnly: true,
    apply: (config, value) => {
      config.bluesky.identifier = optional(value);
    },
  },
  {
    key: "BLUESKY_APP_PASSWORD",
    group: "Bluesky",
    label: "App password",
    kind: "secret",
    userOnly: true,
    apply: (config, value) => {
      config.bluesky.appPassword = optional(value);
    },
  },
  {
    key: "BLUESKY_PDS_URL",
    group: "Bluesky",
    label: "PDS URL",
    description: "Leave empty to auto-discover the PDS from the account's DID document.",
    kind: "string",
    userOnly: true,
    apply: (config, value) => {
      config.bluesky.pdsUrl = optional(value);
    },
  },
  {
    key: "BLUESKY_PUBLIC_URL",
    group: "Bluesky",
    label: "Public AppView URL",
    description: "Fallback host for unauthenticated search.",
    kind: "string",
    default: "https://public.api.bsky.app",
    userOnly: true,
    apply: (config, value) => {
      config.bluesky.publicUrl = optional(value) ?? "https://public.api.bsky.app";
    },
  },

];

/**
 * Settings live in the SQLite key/value store and can be edited in the UI.
 * The environment always wins: a `.env` value shadows the database override
 * (the UI marks those rows as overridden).
 */
export class SettingsService {
  /** Called after an override changed so the kernel can rebuild its providers. */
  onReload: (() => void) | null = null;

  /** The boot-time config (env + defaults); database overrides are layered on top. */
  private readonly base: AppConfig;

  constructor(private readonly options: SettingsServiceOptions) {
    this.base = structuredClone(options.config);
    // The LLM key used to be OpenCode-specific; carry stored values over.
    const legacyLlmKey = options.kv.get(`${DB_PREFIX}OPENCODE_API_KEY`);
    if (legacyLlmKey && !options.kv.get(`${DB_PREFIX}LLM_API_KEY`)) {
      options.kv.set(`${DB_PREFIX}LLM_API_KEY`, legacyLlmKey);
    }
    options.kv.delete(`${DB_PREFIX}OPENCODE_API_KEY`);
  }

  list(): SettingInfo[] {
    return SETTING_DEFINITIONS.map((definition) => this.info(definition));
  }

  set(key: string, value: unknown): SettingInfo {
    const definition = this.definition(key);
    if (value !== undefined && value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new ValidationError(`"value" must be a string, number or boolean`);
    }
    const raw = typeof value === "string" ? value : value == null ? "" : String(value);
    const trimmed = raw.trim();

    if (trimmed === "") {
      this.options.kv.delete(DB_PREFIX + definition.key);
    } else {
      this.validate(definition, trimmed);
      this.options.kv.set(DB_PREFIX + definition.key, trimmed);
    }

    return this.changed(definition);
  }

  clear(key: string): SettingInfo {
    const definition = this.definition(key);
    this.options.kv.delete(DB_PREFIX + definition.key);
    return this.changed(definition);
  }

  /** Recomputes the effective config: boot-time base + env/database overrides. */
  applyAll(): void {
    const config = this.options.config;
    Object.assign(config, structuredClone(this.base));

    for (const definition of SETTING_DEFINITIONS) {
      const { source, effective } = this.resolve(definition);
      // Defaults are already baked into the base config by loadConfig().
      if (source !== "default") definition.apply(config, effective);
    }
  }

  private changed(definition: SettingDefinition): SettingInfo {
    this.applyAll();
    this.options.bus?.publish(
      "settings.updated",
      { key: definition.key, action: this.options.kv.get(DB_PREFIX + definition.key) ? "set" : "cleared" },
      { source: "settings" },
    );
    this.onReload?.();
    return this.info(definition);
  }

  private info(definition: SettingDefinition): SettingInfo {
    const { effective, source } = this.resolve(definition);
    const stored = this.options.kv.get(DB_PREFIX + definition.key);
    const isSecret = definition.kind === "secret";

    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      description: definition.description,
      kind: definition.kind,
      options: definition.options,
      defaultValue: definition.default,
      source,
      value: isSecret ? null : (effective ?? null),
      configured: Boolean(effective),
      stored: stored !== null && stored !== "",
    };
  }

  private resolve(definition: SettingDefinition): { effective?: string; source: SettingSource } {
    // User-owned settings ignore the deployment environment entirely.
    if (!definition.userOnly) {
      const envValue = this.options.env[definition.key];
      if (envValue !== undefined && envValue !== "") {
        return { effective: envValue, source: "env" };
      }
    }

    const stored = this.options.kv.get(DB_PREFIX + definition.key);
    if (stored !== null && stored !== "") {
      return { effective: stored, source: "db" };
    }

    return { effective: definition.default, source: "default" };
  }

  private definition(key: string): SettingDefinition {
    const definition = SETTING_DEFINITIONS.find((entry) => entry.key === key);
    if (!definition) throw new ValidationError(`Unknown setting "${key}"`);
    return definition;
  }

  private validate(definition: SettingDefinition, value: string): void {
    switch (definition.kind) {
      case "number":
        if (!Number.isFinite(Number(value))) {
          throw new ValidationError(`"${definition.key}" must be a number`);
        }
        return;
      case "boolean":
        if (!["true", "false", "1", "0", "yes", "no", "on", "off"].includes(value.toLowerCase())) {
          throw new ValidationError(`"${definition.key}" must be true or false`);
        }
        return;
      case "enum":
        if (!definition.options?.includes(value)) {
          throw new ValidationError(
            `"${definition.key}" must be one of: ${definition.options?.join(", ")}`,
          );
        }
        return;
      default:
        return;
    }
  }
}
