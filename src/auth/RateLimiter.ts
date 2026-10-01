export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until a slot frees up; 0 when the call was allowed. */
  retryAfterMs: number;
}

/**
 * Sliding-window limiter: at most `limit` calls per `windowMs` for each key
 * (client addresses for the login endpoint). State is in memory and pruned on
 * use; the clock is injectable for tests.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string): RateLimitResult {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(1, oldest + this.windowMs - now) };
    }

    recent.push(now);
    this.hits.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }
}
