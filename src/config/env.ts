import type { LogLevel } from "../core/logger.ts";
import type { SearchRecency } from "../capabilities/search/SearchProvider.ts";

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
  timezone: string;
  logLevel: LogLevel;
  /** Site protection; no mechanism configured means the site is open. */
  auth: {
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
    /** Dispatch follow-up subagents after the first draft. */
    followups: boolean;
    /** Extract dated events from finished briefs and build a timeline. */
    events: boolean;
    /** Model for the tag decision step; empty uses the main LLM model. */
    eventTagModel?: string;
    briefLanguage: string;
  };
  /** Price table for metered providers; 0 means unknown (usage is still recorded). */
  costs: {
    llmInputPerMillion: number;
    llmOutputPerMillion: number;
    perplexitySearchPerRequest: number;
  };
  llm: {
    apiKey?: string;
    baseUrl: string;
    model: string;
    sessionId?: string;
  };
  perplexity: {
    apiKey?: string;
    baseUrl: string;
    /** Model used by the Agent API finance_search tool. */
    financeModel: string;
  };
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
    timezone: str(env, "TZ", "UTC")!,
    logLevel: str(env, "LOG_LEVEL", "info") as LogLevel,
    auth: {
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
      followups: bool(env, "DEFAULT_FOLLOWUP_RESEARCH", true),
      events: bool(env, "DEFAULT_EVENT_EXTRACTION", true),
      eventTagModel: str(env, "EVENTS_TAG_MODEL", "") || undefined,
      briefLanguage: str(env, "DEFAULT_BRIEF_LANGUAGE", "en")!,
    },
    costs: {
      llmInputPerMillion: num(env, "LLM_PRICE_INPUT_PER_M", 0.3),
      llmOutputPerMillion: num(env, "LLM_PRICE_OUTPUT_PER_M", 1.2),
      perplexitySearchPerRequest: num(env, "PERPLEXITY_PRICE_PER_SEARCH", 0.005),
    },
    llm: {
      apiKey: str(env, "OPENCODE_API_KEY"),
      baseUrl: str(env, "LLM_BASE_URL", "https://opencode.ai/zen/go/v1")!,
      model: str(env, "LLM_MODEL", "deepseek-v4.1-flash")!,
      sessionId: str(env, "LLM_SESSION_ID"),
    },
    perplexity: {
      apiKey: str(env, "KEY_PERPLEXITY"),
      baseUrl: str(env, "PERPLEXITY_BASE_URL", "https://api.perplexity.ai")!,
      financeModel: str(
        env,
        "PERPLEXITY_FINANCE_MODEL",
        "perplexity/glm-5.3-flash",
      )!,
    },
    qwenTts: {
      baseUrl: str(env, "QWEN_TTS_BASE_URL") ?? "",
      model: str(env, "QWEN_TTS_MODEL", "tts-1")!,
      voiceId: str(env, "QWEN_TTS_VOICE", "Ryan")!,
      outputFormat: str(env, "QWEN_TTS_FORMAT", "opus")!,
      requestFormat: str(env, "QWEN_TTS_REQUEST_FORMAT"),
      language: str(env, "QWEN_TTS_LANGUAGE"),
      speed: num(env, "QWEN_TTS_SPEED", 1),
      apiKey: str(env, "QWEN_TTS_API_KEY"),
      // Local CPU inference runs several times slower than real time, so the
      // default leaves room for a minute of narration (GPU servers answer
      // in seconds and never come close to this bound).
      timeoutMs: num(env, "QWEN_TTS_TIMEOUT_MS", 600_000),
    },
    elevenlabs: {
      apiKey: str(env, "KEY_ELEVENLABS"),
      baseUrl: str(env, "ELEVENLABS_BASE_URL", "https://api.elevenlabs.io")!,
      modelId: str(env, "ELEVENLABS_MODEL_ID", "eleven_v4")!,
      voiceId: str(env, "ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")!,
      outputFormat: str(env, "ELEVENLABS_OUTPUT_FORMAT", "opus_48000_128")!,
      speed: num(env, "ELEVENLABS_SPEED", 1.15),
      maxCharsPerRequest: num(env, "ELEVENLABS_MAX_CHARS", 2600),
    },
    bluesky: {
      identifier: str(env, "BLUESKY_IDENTIFIER"),
      appPassword: str(env, "BLUESKY_APP_PASSWORD"),
      pdsUrl: str(env, "BLUESKY_PDS_URL"),
      publicUrl: str(env, "BLUESKY_PUBLIC_URL", "https://public.api.bsky.app")!,
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
  perplexity: boolean;
  tts: boolean;
  bluesky: "authenticated" | "public";
}

export function configStatus(config: AppConfig): ConfigStatus {
  return {
    llm: Boolean(config.llm.apiKey),
    perplexity: Boolean(config.perplexity.apiKey),
    tts: Boolean(config.qwenTts.baseUrl),
    bluesky:
      config.bluesky.identifier && config.bluesky.appPassword ? "authenticated" : "public",
  };
}
