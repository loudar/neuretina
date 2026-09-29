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
    briefLanguage: string;
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
  matrix: {
    homeserverUrl?: string;
    accessToken?: string;
    username?: string;
    password?: string;
    roomId?: string;
    chatCommands: boolean;
    allowedSenders?: string[];
  };
}

type Env = Record<string, string | undefined>;

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
    startup: {
      enabled: bool(env, "STARTUP_CHECK", true),
      announce: bool(env, "STARTUP_ANNOUNCE", false),
    },
    defaults: {
      briefCron: str(env, "DEFAULT_BRIEF_CRON", "0 7 * * *")!,
      searchRecency: recency,
      searchResultsPerProvider: num(env, "DEFAULT_SEARCH_RESULTS", 6),
      searchDomains: parseSearchDomains(env),
      briefLanguage: str(env, "DEFAULT_BRIEF_LANGUAGE", "en")!,
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
    matrix: {
      homeserverUrl: str(env, "MATRIX_HOMESERVER_URL"),
      accessToken: str(env, "MATRIX_ACCESS_TOKEN"),
      username: str(env, "MATRIX_USERNAME"),
      password: str(env, "MATRIX_PASSWORD"),
      roomId: str(env, "MATRIX_ROOM_ID"),
      chatCommands: bool(env, "MATRIX_CHAT_COMMANDS", true),
      allowedSenders: list(env, "MATRIX_ALLOWED_SENDERS"),
    },
  };
}

export interface ConfigStatus {
  llm: boolean;
  perplexity: boolean;
  elevenlabs: boolean;
  bluesky: "authenticated" | "public";
  matrix: boolean;
}

export function configStatus(config: AppConfig): ConfigStatus {
  return {
    llm: Boolean(config.llm.apiKey),
    perplexity: Boolean(config.perplexity.apiKey),
    elevenlabs: Boolean(config.elevenlabs.apiKey),
    bluesky:
      config.bluesky.identifier && config.bluesky.appPassword ? "authenticated" : "public",
    matrix: Boolean(
      config.matrix.homeserverUrl &&
        config.matrix.roomId &&
        (config.matrix.accessToken || (config.matrix.username && config.matrix.password)),
    ),
  };
}
