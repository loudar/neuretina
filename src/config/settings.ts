import type { SearchRecency } from "../capabilities/search/SearchProvider.ts";
import { parseSearchConnections } from "../capabilities/search/SearchProviders.ts";
import { parseFinanceConnections } from "../capabilities/finance/FinanceProviders.ts";
import { parseDecisionModelConnections } from "../capabilities/decision/DecisionProviders.ts";
import {
  LLM_PROVIDER_PRESETS,
  parseLlmConnections,
  type LlmConnection,
} from "../capabilities/llm/LlmProviders.ts";
import { ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { KeyValueStore } from "../domain/kv/KeyValueRepository.ts";
import type { AppConfig, Env } from "./env.ts";
import { DEFAULT_SEARCH_DOMAINS } from "./env.ts";

export type SettingKind = "string" | "secret" | "number" | "boolean" | "list" | "enum" | "json";
export type SettingSource = "env" | "db" | "default";

/** A setting the service can read, validate and apply (spec plus behavior). */
export type SettingDefinition = Omit<SettingSpec, "path"> & {
  apply(config: AppConfig, value: string | undefined): void;
};

export interface SettingInfo {
  key: string;
  group: string;
  label: string;
  kind: SettingKind;
  options?: string[];
  defaultValue?: string;
  /** Where the effective value comes from; `env` always wins. */
  source: SettingSource;
  /** Effective value (secrets included) so the UI can reveal it with the eye toggle. */
  value: string | null;
  /** Whether an effective value exists (secrets included). */
  configured: boolean;
  /** Whether a database override is stored (even when the environment shadows it). */
  stored: boolean;
}

/** One stored (database) override, secrets included. */
export interface StoredSetting {
  key: string;
  value: string;
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

interface SettingSpec {
  key: string;
  group: string;
  label: string;
  kind: SettingKind;
  options?: string[];
  default?: string;
  userOnly?: boolean;
  /** Shape check for parsed `json` values. */
  validate?: (value: unknown) => boolean;
  /** Dotted path into AppConfig the effective value is written to. */
  path: string;
}

/** One row per setting; the definition's behavior is derived from this. */
const SETTING_SPECS: SettingSpec[] = [
  {
    key: "LLM_PROVIDERS",
    group: "LLM",
    label: "Configured providers",
    kind: "json",
    userOnly: true,
    validate: (value) => parseLlmConnections(value) !== undefined,
    path: "llmProviders",
  },
  {
    key: "LLM_PROVIDER",
    group: "LLM",
    label: "Active provider",
    kind: "string",
    userOnly: true,
    path: "llmProvider",
  },
  {
    key: "DECISION_MODELS",
    group: "Decision models",
    label: "Configured models",
    kind: "json",
    userOnly: true,
    validate: (value) => parseDecisionModelConnections(value) !== undefined,
    path: "decisionModels",
  },
  {
    key: "DECISION_MODEL",
    group: "Decision models",
    label: "Active model",
    kind: "string",
    userOnly: true,
    path: "decisionModel",
  },
  {
    key: "SEARCH_PROVIDERS",
    group: "Web search",
    label: "Configured providers",
    kind: "json",
    userOnly: true,
    validate: (value) => parseSearchConnections(value) !== undefined,
    path: "searchProviders",
  },
  {
    key: "SEARCH_PROVIDER",
    group: "Web search",
    label: "Active provider",
    kind: "string",
    userOnly: true,
    path: "searchProvider",
  },
  {
    key: "FINANCE_PROVIDERS",
    group: "Finance data",
    label: "Configured providers",
    kind: "json",
    userOnly: true,
    validate: (value) => parseFinanceConnections(value) !== undefined,
    path: "financeProviders",
  },
  {
    key: "TTS_PROVIDER",
    group: "Speech",
    label: "Provider",
    kind: "enum",
    options: ["qwen", "elevenlabs"],
    default: "qwen",
    userOnly: true,
    path: "tts.provider",
  },
  {
    key: "QWEN_TTS_BASE_URL",
    group: "Speech (Qwen3-TTS)",
    label: "Base URL",
    kind: "string",
    default: "",
    userOnly: true,
    path: "qwenTts.baseUrl",
  },
  {
    key: "QWEN_TTS_MODEL",
    group: "Speech (Qwen3-TTS)",
    label: "Model",
    kind: "string",
    default: "tts-1",
    userOnly: true,
    path: "qwenTts.model",
  },
  {
    key: "QWEN_TTS_VOICE",
    group: "Speech (Qwen3-TTS)",
    label: "Voice",
    kind: "string",
    default: "Ryan",
    userOnly: true,
    path: "qwenTts.voiceId",
  },
  {
    key: "QWEN_TTS_FORMAT",
    group: "Speech (Qwen3-TTS)",
    label: "Output format",
    kind: "enum",
    options: ["opus", "wav", "mp3", "flac", "aac", "pcm"],
    default: "opus",
    userOnly: true,
    path: "qwenTts.outputFormat",
  },
  {
    key: "QWEN_TTS_REQUEST_FORMAT",
    group: "Speech (Qwen3-TTS)",
    label: "Server request format",
    kind: "enum",
    options: ["opus", "wav", "mp3", "flac", "aac", "pcm"],
    userOnly: true,
    path: "qwenTts.requestFormat",
  },
  {
    key: "QWEN_TTS_SPEED",
    group: "Speech (Qwen3-TTS)",
    label: "Speed",
    kind: "number",
    default: "1",
    userOnly: true,
    path: "qwenTts.speed",
  },
  {
    key: "QWEN_TTS_LANGUAGE",
    group: "Speech (Qwen3-TTS)",
    label: "Language",
    kind: "string",
    userOnly: true,
    path: "qwenTts.language",
  },
  {
    key: "QWEN_TTS_API_KEY",
    group: "Speech (Qwen3-TTS)",
    label: "API key",
    kind: "secret",
    userOnly: true,
    path: "qwenTts.apiKey",
  },
  {
    key: "QWEN_TTS_TIMEOUT_MS",
    group: "Speech (Qwen3-TTS)",
    label: "Synthesis timeout (ms)",
    kind: "number",
    default: "600000",
    userOnly: true,
    path: "qwenTts.timeoutMs",
  },
  {
    key: "KEY_ELEVENLABS",
    group: "Speech (ElevenLabs)",
    label: "API key",
    kind: "secret",
    userOnly: true,
    path: "elevenlabs.apiKey",
  },
  {
    key: "ELEVENLABS_VOICE_ID",
    group: "Speech (ElevenLabs)",
    label: "Voice id",
    kind: "string",
    default: "JBFqnCBsd6RMkjVDRZzb",
    userOnly: true,
    path: "elevenlabs.voiceId",
  },
  {
    key: "ELEVENLABS_MODEL_ID",
    group: "Speech (ElevenLabs)",
    label: "Model",
    kind: "string",
    default: "eleven_v4",
    userOnly: true,
    path: "elevenlabs.modelId",
  },
  {
    key: "ELEVENLABS_SPEED",
    group: "Speech (ElevenLabs)",
    label: "Speed",
    kind: "number",
    default: "1.15",
    userOnly: true,
    path: "elevenlabs.speed",
  },
  {
    key: "BLUESKY_IDENTIFIER",
    group: "Bluesky",
    label: "Handle",
    kind: "string",
    userOnly: true,
    path: "bluesky.identifier",
  },
  {
    key: "BLUESKY_APP_PASSWORD",
    group: "Bluesky",
    label: "App password",
    kind: "secret",
    userOnly: true,
    path: "bluesky.appPassword",
  },
  {
    key: "BLUESKY_PDS_URL",
    group: "Bluesky",
    label: "PDS URL",
    kind: "string",
    userOnly: true,
    path: "bluesky.pdsUrl",
  },
  {
    key: "BLUESKY_PUBLIC_URL",
    group: "Bluesky",
    label: "Public AppView URL",
    kind: "string",
    default: "https://public.api.bsky.app",
    userOnly: true,
    path: "bluesky.publicUrl",
  },
];

export const SETTING_DEFINITIONS: SettingDefinition[] = SETTING_SPECS.map(({ path, ...spec }) => ({
  ...spec,
  apply: (config, value) => {
    const parsed = parseSetting(spec, value);
    // A cleared or malformed JSON value must not blank the config default
    // (applyAll restores the base config before every pass).
    if (parsed === undefined && spec.kind === "json") return;
    setPath(config, path, parsed);
  },
}));

/** Parses a raw setting value into the shape its config path expects. */
function parseSetting(
  spec: Pick<SettingSpec, "kind" | "default">,
  value: string | undefined,
): unknown {
  if (spec.kind === "number") return toNumber(value, Number(spec.default ?? 0));
  if (spec.kind === "json") {
    if (!value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      // Validation rejects malformed values before they are stored; a
      // hand-edited database value must not crash the boot.
      return undefined;
    }
  }
  if (spec.default !== undefined) return optional(value) ?? spec.default;
  return optional(value);
}

/** Writes a dotted path ("llm.apiKey") on the config object. */
function setPath(target: object, path: string, value: unknown): void {
  const parts = path.split(".");
  const last = parts.pop();
  if (!last) return;
  let node = target as Record<string, unknown>;
  for (const part of parts) node = node[part] as Record<string, unknown>;
  node[last] = value;
}

/**
 * The LLM used to be three settings (LLM_API_KEY / LLM_BASE_URL / LLM_MODEL,
 * originally OPENCODE_API_KEY); fold whatever was stored into one connection
 * so existing installations keep their endpoint, then drop the old keys.
 */
function migrateLegacyLlmSettings(kv: KeyValueStore): void {
  if (!kv.get(`${DB_PREFIX}LLM_PROVIDERS`)) {
    const apiKey =
      kv.get(`${DB_PREFIX}LLM_API_KEY`) ?? kv.get(`${DB_PREFIX}OPENCODE_API_KEY`);
    const baseUrl = kv.get(`${DB_PREFIX}LLM_BASE_URL`);
    const model = kv.get(`${DB_PREFIX}LLM_MODEL`);
    if (apiKey || baseUrl || model) {
      const connection: LlmConnection = {
        id: crypto.randomUUID(),
        provider: "opencode",
        baseUrl: baseUrl ?? LLM_PROVIDER_PRESETS.opencode.defaultBaseUrl,
        model: model ?? LLM_PROVIDER_PRESETS.opencode.defaultModel,
        ...(apiKey ? { apiKey } : {}),
      };
      kv.set(`${DB_PREFIX}LLM_PROVIDERS`, JSON.stringify([connection]));
      kv.set(`${DB_PREFIX}LLM_PROVIDER`, connection.id);
    }
  }
  for (const key of ["OPENCODE_API_KEY", "LLM_API_KEY", "LLM_BASE_URL", "LLM_MODEL"]) {
    kv.delete(`${DB_PREFIX}${key}`);
  }
}

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
    migrateLegacyLlmSettings(options.kv);
  }

  list(): SettingInfo[] {
    return SETTING_DEFINITIONS.map((definition) => this.info(definition));
  }

  set(key: string, value: unknown): SettingInfo {
    const definition = this.definition(key);
    this.store(definition, value);
    return this.changed(definition);
  }

  clear(key: string): SettingInfo {
    const definition = this.definition(key);
    this.options.kv.delete(DB_PREFIX + definition.key);
    return this.changed(definition);
  }

  /**
   * Every stored override, secrets (API keys) included. This is the
   * persistence half of a data bundle, so treat the result as sensitive.
   */
  exportStored(): StoredSetting[] {
    const entries: StoredSetting[] = [];
    for (const definition of SETTING_DEFINITIONS) {
      const value = this.options.kv.get(DB_PREFIX + definition.key);
      if (value !== null && value !== "") entries.push({ key: definition.key, value });
    }
    return entries;
  }

  /**
   * Restores stored overrides from a bundle (unknown keys and non-string
   * values are skipped, so bundles from other versions stay importable) and
   * applies the whole batch at once: one provider reload per import.
   */
  importStored(entries: unknown): number {
    if (!Array.isArray(entries)) return 0;

    const applied: SettingDefinition[] = [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const record = entry as Record<string, unknown>;
      if (typeof record.key !== "string" || typeof record.value !== "string") continue;
      const definition = SETTING_DEFINITIONS.find((candidate) => candidate.key === record.key);
      if (!definition) continue;
      this.store(definition, record.value);
      applied.push(definition);
    }

    if (applied.length === 0) return 0;
    this.applyAll();
    for (const definition of applied) {
      this.options.bus?.publish(
        "settings.updated",
        { key: definition.key, action: this.options.kv.get(DB_PREFIX + definition.key) ? "set" : "cleared" },
        { source: "settings" },
      );
    }
    this.onReload?.();
    return applied.length;
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

  /** Validates and writes (or clears) one stored override. */
  private store(definition: SettingDefinition, value: unknown): void {
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

    return {
      key: definition.key,
      group: definition.group,
      label: definition.label,
      kind: definition.kind,
      options: definition.options,
      defaultValue: definition.default,
      source,
      value: effective ?? null,
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
      case "json": {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          throw new ValidationError(`"${definition.key}" must be valid JSON`);
        }
        if (definition.validate && !definition.validate(parsed)) {
          throw new ValidationError(`"${definition.key}" is not valid`);
        }
        return;
      }
      default:
        return;
    }
  }
}
