import { ProviderError } from "../../core/errors.ts";

export interface RetryOptions {
  /** Extra attempts after the first (0 = no retries). */
  retries?: number;
  retryStatuses?: number[];
  baseDelayMs?: number;
  /** Abort a single attempt after this long (default 90s). */
  timeoutMs?: number;
}

/** Statuses that are safe to retry: transient auth/rate-limit/server errors. */
const DEFAULT_RETRY_STATUSES = [401, 408, 425, 429, 500, 502, 503, 504];
const DEFAULT_TIMEOUT_MS = 90_000;

export async function requestRaw(
  provider: string,
  url: string,
  init: RequestInit = {},
  retry: RetryOptions = {},
): Promise<Response> {
  const retries = retry.retries ?? 0;
  const retryStatuses = retry.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const baseDelayMs = retry.baseDelayMs ?? 700;
  const timeoutMs = retry.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastError: ProviderError | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    try {
      // Providers must never hang a workflow run: each attempt is bounded.
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
      response = await fetch(url, { ...init, signal });
    } catch (cause) {
      const error = new ProviderError(provider, `network request failed: ${url}`, { cause });
      if (attempt < retries) {
        lastError = error;
        await sleep(baseDelayMs * (attempt + 1));
        continue;
      }
      throw error;
    }

    if (response.ok) return response;

    const body = await response.text().catch(() => "");
    const error = new ProviderError(
      provider,
      `HTTP ${response.status} for ${url}${describeBody(body)}`,
      { status: response.status, details: { body: body.slice(0, 600) } },
    );

    if (attempt < retries && retryStatuses.includes(response.status)) {
      lastError = error;
      await sleep(baseDelayMs * (attempt + 1));
      continue;
    }

    throw error;
  }

  throw lastError ?? new ProviderError(provider, `request failed: ${url}`);
}

export async function requestJson<T>(
  provider: string,
  url: string,
  init: RequestInit = {},
  retry: RetryOptions = {},
): Promise<T> {
  const response = await requestRaw(provider, url, init, retry);
  try {
    return (await response.json()) as T;
  } catch (error) {
    throw new ProviderError(provider, `invalid JSON response from ${url}`, { cause: error });
  }
}

/** Compact, single-line hint about *why* a request failed (e.g. API error messages). */
function describeBody(body: string): string {
  const text = body.trim();
  if (!text) return "";
  try {
    const parsed = JSON.parse(text) as {
      detail?: { message?: unknown } | string;
      error?: { message?: unknown } | string;
      message?: unknown;
      errmsg?: unknown;
      errcode?: unknown;
    };
    const detail = parsed.detail;
    const candidates = [
      typeof detail === "string" ? detail : detail?.message,
      typeof parsed.error === "string" ? parsed.error : parsed.error?.message,
      parsed.message,
      parsed.errmsg,
      parsed.errcode,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return ` — ${candidate.trim().replace(/\s+/g, " ").slice(0, 200)}`;
      }
    }
  } catch {
    // not JSON; fall through to raw excerpt
  }
  return ` — ${text.replace(/\s+/g, " ").slice(0, 200)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
