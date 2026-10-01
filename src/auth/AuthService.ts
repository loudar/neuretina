import type { AppConfig } from "../config/env.ts";
import type { AuthMethodInfo, AuthProvider } from "./AuthProvider.ts";
import { passwordAuthProvider } from "./PasswordAuthProvider.ts";
import { issueSessionToken, verifySessionToken, type AuthSession } from "./session.ts";

export type { AuthSession } from "./session.ts";

export interface AuthStatusInfo {
  /** True when at least one mechanism is configured. */
  required: boolean;
  authenticated: boolean;
  /** Mechanism that authenticated the current session, when any. */
  method?: string;
  /** Configured mechanisms, for the login screen. */
  methods: AuthMethodInfo[];
}

export interface AuthLoginResult {
  session: AuthSession;
  token: string;
  maxAgeSeconds: number;
}

export interface AuthServiceOptions {
  /** Live config object: settings changes (e.g. a new password) take effect immediately. */
  config: AppConfig;
  /** Mechanisms; defaults to the global password provider. */
  providers?: AuthProvider[];
  now?: () => number;
}

const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Authentication façade: reports which mechanisms are configured, verifies
 * logins and sessions, and throttles repeated failures per client key.
 * Everything is one global principal until per-user support lands.
 */
export class AuthService {
  private readonly providers: AuthProvider[];
  private readonly now: () => number;
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly options: AuthServiceOptions) {
    this.providers = options.providers ?? [passwordAuthProvider];
    this.now = options.now ?? Date.now;
  }

  private get config(): AppConfig {
    return this.options.config;
  }

  /** True when the site is protected by at least one mechanism. */
  get enabled(): boolean {
    return this.methods().length > 0;
  }

  methods(): AuthMethodInfo[] {
    return this.providers
      .filter((provider) => provider.available(this.config))
      .map((provider) => ({ id: provider.id, title: provider.title }));
  }

  status(token: string | undefined): AuthStatusInfo {
    const required = this.enabled;
    const session = required ? this.verify(token) : null;
    return {
      required,
      authenticated: !required || session !== null,
      ...(session ? { method: session.method } : {}),
      methods: required ? this.methods() : [],
    };
  }

  verify(token: string | undefined): AuthSession | null {
    if (!this.enabled) return null;
    return verifySessionToken(this.config, token, this.now());
  }

  /** Verifies credentials and issues a signed session token; null on failure. */
  login(
    method: string | undefined,
    credentials: Record<string, unknown>,
  ): AuthLoginResult | null {
    if (!this.enabled) return null;
    const provider = method
      ? this.providers.find((entry) => entry.id === method && entry.available(this.config))
      : this.providers.find((entry) => entry.available(this.config));
    if (!provider) return null;

    const identity = provider.authenticate(this.config, credentials);
    if (!identity) return null;

    const ttlMs = this.sessionTtlMs();
    const token = issueSessionToken(this.config, identity, ttlMs, this.now());
    if (!token) return null;

    return {
      session: { subject: identity.subject, method: provider.id, expiresAt: this.now() + ttlMs },
      token,
      maxAgeSeconds: Math.floor(ttlMs / 1000),
    };
  }

  blocked(key: string): boolean {
    const entry = this.failures.get(key);
    if (!entry) return false;
    if (entry.resetAt <= this.now()) {
      this.failures.delete(key);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + FAILURE_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  clearFailures(key: string): void {
    this.failures.delete(key);
  }

  private sessionTtlMs(): number {
    return Math.max(1, this.config.auth.sessionTtlHours) * 60 * 60 * 1000;
  }
}
