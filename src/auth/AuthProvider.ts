import type { AppConfig } from "../config/env.ts";

/**
 * Identity a provider vouches for. Everything is one global principal today;
 * per-user support will fill `subject` with the user id and use `attributes`
 * to select the user's config and data scope.
 */
export interface AuthIdentity {
  /** Stable principal id ("global" until users exist). */
  subject: string;
  method: string;
  /** Extra claims for future per-user configuration; empty for now. */
  attributes?: Record<string, string>;
}

/**
 * An authentication mechanism. Password-style providers verify credentials
 * carried in the login request; redirect-based providers (OIDC, later) will
 * wrap their handshake around the same identity shape.
 */
export interface AuthProvider {
  id: string;
  title: string;
  /** Whether the mechanism is usable with the current configuration. */
  available(config: AppConfig): boolean;
  /** Verifies submitted credentials; returns null when they don't match. */
  authenticate(config: AppConfig, credentials: Record<string, unknown>): AuthIdentity | null;
}

/** Mechanism as advertised to the login screen. */
export interface AuthMethodInfo {
  id: string;
  title: string;
}
