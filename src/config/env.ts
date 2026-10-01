import type { LogLevel } from "../core/logger.ts";
import type { SearchRecency } from "../capabilities/search/SearchProvider.ts";
import type { SearchConnection } from "../capabilities/search/SearchProviders.ts";
import type { FinanceConnection } from "../capabilities/finance/FinanceProviders.ts";
import type { DecisionModelConnection } from "../capabilities/decision/DecisionProviders.ts";
import {
  activeLlmConnection,
  isLlmConnectionConfigured,
  type LlmConnection,
} from "../capabilities/llm/LlmProviders.ts";

export type { SearchRecency };

/**
 * Default web-search allowlist: Wikipedia, major wires and outlets with strong
 * correction records, quality tech/science press and .gov primary sources.
 * Perplexity's `search_domain_filter` accepts at most 20 entries; root domains
 * match their subdomains and ".gov" matches the whole TLD.
 */
export const DEFAULT_SEARCH_DOMAINS = [
  "wikipedia.org",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "npr.org",
  "theguardian.com",
  "nytimes.com",
  "washingtonpost.com",
  "ft.com",
  "economist.com",
  "bloomberg.com",
  "cnbc.com",
  "aljazeera.com",
  "dw.com",
  "arstechnica.com",
  "theverge.com",
  "techcrunch.com",
  "nature.com",
  "science.org",
  ".gov",
];

export interface AppConfig {
  port: number;
  dbPath: string;
  webDist: string | null;
  /** Public URL of this deployment, used for links in delivered messages. */
  appUrl?: string;
  timezone: string;
  logLevel: LogLevel;
  /** Site protection; no mechanism configured means the site is open. */
  auth: {
    /** Account that owns the main database and the global password login. */
    adminUsername: string;
    /** Shared password for the whole site; empty disables authentication. */
    globalPassword?: string;
    /** Signs login sessions; empty derives it from the global password. */
    sessionSecret?: string;
    /** How long a login lasts before the password is asked again. */
    sessionTtlHours: number;
  };
  startup: {
    enabled: boolean;
    /** Send the validation summary to Matrix on boot (off by default). */
    announce: boolean;
  };
  defaults: {
    briefCron: string;
    searchRecency: SearchRecency;
    searchResultsPerProvider: number;
    /** Reputable-source allowlist for web search; empty disables the filter. */
    searchDomains: string[];
    /** Model for the tag decision step; empty uses the main LLM model. */
    eventTagModel?: string;
    briefLanguage: string;
  };
  /** LLM connections (provider + model pairings); user-owned settings. */
  llmProviders: LlmConnection[];
  /** Selected LLM connection id; empty uses the first configured one. */
  llmProvider?: string;
  /** Web-search connections (Perplexity, Exa); user-owned settings. */
  searchProviders: SearchConnection[];
  /** Selected web-search connection id; empty uses the first configured one. */
  searchProvider?: string;
  /** Finance-data connections (Perplexity, Yahoo Finance); user-owned settings. */
  financeProviders: FinanceConnection[];
  /** Local OpenAI-compatible Qwen3-TTS server (the active speech provider). */
  qwenTts: {
    baseUrl: string;
    model: string;
    voiceId: string;
    outputFormat: string;
    /** Format asked from the server when it differs from outputFormat. */
    requestFormat?: string;
    language?: string;
    speed: number;
    apiKey?: string;
    /** Per-attempt synthesis timeout; CPU servers need minutes per brief. */
    timeoutMs: number;
  };
  /** Kept for later; the ElevenLabs provider module is currently unused. */
  elevenlabs: {
    apiKey?: string;
    baseUrl: string;
    modelId: string;
    voiceId: string;
    outputFormat: string;
    /** Speaking rate for models that support it (Eleven v4 ignores this). */
    speed: number;
    maxCharsPerRequest: number;
  };
  /** Active speech provider; both implement the shared TTS protocol. */
  tts: {
    provider: "qwen" | "elevenlabs";
  };
  /** Local Laya decision model used for event tagging. */
  laya: {
    enabled: boolean;
    modelDir: string;
    /** Minimum confidence before a Laya tag pick is accepted. */
    confidenceThreshold: number;
  };
  /** Hosted decision-model connections (Jev, Clef); user-owned settings. */
  decisionModels: DecisionModelConnection[];
  /** Selected hosted connection id; empty falls back to the local model. */
  decisionModel?: string;
  bluesky: {
    identifier?: string;
    appPassword?: string;
    pdsUrl?: string;
    publicUrl: string;
  };
}

export type Env = Record<string, string | undefined>;

function str(env: Env, name: string, fallback?: string): string | undefined {
  const value = env[name];
  return value === undefined || value === "" ? fallback : value;
}

function num(env: Env, name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return fallback;
  return !["false", "0", "no", "off"].includes(value);
}

function list(env: Env, name: string): string[] | undefined {
  const value = str(env, name);
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

/**
 * `DEFAULT_SEARCH_DOMAINS` — comma-separated allowlist. Unset uses the
 * reputable default; `off`/`none` disables the filter entirely.
 */
function parseSearchDomains(env: Env): string[] {
  const raw = str(env, "DEFAULT_SEARCH_DOMAINS");
  if (raw === undefined) return [...DEFAULT_SEARCH_DOMAINS];
  if (["off", "none", "false", "0"].includes(raw.trim().toLowerCase())) return [];
  return raw
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)
    .slice(0, 20);
}

export function loadConfig(env: Env = Bun.env): AppConfig {
  const recency = str(env, "DEFAULT_SEARCH_RECENCY", "3days") as SearchRecency;

  return {
    port: num(env, "PORT", 8080),
    dbPath: str(env, "DB_PATH", "./data/app.db")!,
    webDist: str(env, "WEB_DIST") ?? null,
    appUrl: str(env, "APP_URL"),
    timezone: str(env, "TZ", "UTC")!,
    logLevel: str(env, "LOG_LEVEL", "info") as LogLevel,
    auth: {
      adminUsername: str(env, "ADMIN_USERNAME", "admin")!,
      globalPassword: str(env, "AUTH_GLOBAL_PASSWORD"),
      sessionSecret: str(env, "AUTH_SESSION_SECRET"),
      sessionTtlHours: num(env, "AUTH_SESSION_TTL_HOURS", 720),
    },
    startup: {
      enabled: bool(env, "STARTUP_CHECK", true),
      announce: bool(env, "STARTUP_ANNOUNCE", false),
    },
    defaults: {
      briefCron: str(env, "DEFAULT_BRIEF_CRON", "0 7 * * *")!,
      searchRecency: recency,
      searchResultsPerProvider: num(env, "DEFAULT_SEARCH_RESULTS", 6),
      searchDomains: parseSearchDomains(env),
      eventTagModel: str(env, "EVENTS_TAG_MODEL", "") || undefined,
      briefLanguage: str(env, "DEFAULT_BRIEF_LANGUAGE", "en")!,
    },
    // LLM, web-search and finance connections are user-owned (they carry API
    // keys and live in the UI settings, never in the deployment environment).
    llmProviders: [],
    llmProvider: undefined,
    searchProviders: [],
    searchProvider: undefined,
    financeProviders: [],
    qwenTts: {
      // User-owned settings: UI only.
      baseUrl: "",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
      requestFormat: undefined,
      language: undefined,
      speed: 1,
      apiKey: undefined,
      // Local CPU inference runs several times slower than real time, so the
      // default leaves room for a minute of narration.
      timeoutMs: 600_000,
    },
    elevenlabs: {
      // User-owned settings: UI only.
      apiKey: undefined,
      baseUrl: "https://api.elevenlabs.io",
      modelId: "eleven_v4",
      voiceId: "JBFqnCBsd6RMkjVDRZzb",
      outputFormat: "opus_48000_128",
      speed: 1.15,
      maxCharsPerRequest: 2600,
    },
    /** Active speech provider; both speak the shared TTS protocol. */
    tts: {
      provider: "qwen",
    },
    laya: {
      enabled: bool(env, "LAYA_ENABLED", true),
      modelDir: str(env, "LAYA_MODEL_DIR", "./data/models/laya")!,
      confidenceThreshold: num(env, "LAYA_CONFIDENCE_THRESHOLD", 0.55),
    },
    // Hosted decision models are user-owned (connections and keys live in
    // the UI settings, never in the deployment environment).
    decisionModels: [],
    decisionModel: undefined,
    bluesky: {
      // User-owned credentials: UI settings only.
      identifier: undefined,
      appPassword: undefined,
      pdsUrl: undefined,
      publicUrl: "https://public.api.bsky.app",
    },
  };
}

/** Environment variables whose database overrides the Matrix boot migration consumes. */
export const LEGACY_MATRIX_KEYS = [
  "MATRIX_HOMESERVER_URL",
  "MATRIX_ACCESS_TOKEN",
  "MATRIX_USERNAME",
  "MATRIX_PASSWORD",
  "MATRIX_ROOM_ID",
  "MATRIX_ALLOWED_SENDERS",
] as const;

export interface ConfigStatus {
  llm: boolean;
  search: boolean;
  tts: boolean;
  bluesky: "authenticated" | "public";
}

export function configStatus(config: AppConfig): ConfigStatus {
  return {
    llm: isLlmConnectionConfigured(
      activeLlmConnection(config.llmProviders, config.llmProvider),
    ),
    search: Array.isArray(config.searchProviders) && config.searchProviders.length > 0,
    tts:
      config.tts.provider === "elevenlabs"
        ? Boolean(config.elevenlabs.apiKey)
        : Boolean(config.qwenTts.baseUrl),
    bluesky:
      config.bluesky.identifier && config.bluesky.appPassword ? "authenticated" : "public",
  };
}
