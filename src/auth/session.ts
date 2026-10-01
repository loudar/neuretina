import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "../config/env.ts";
import type { AuthIdentity } from "./AuthProvider.ts";

const TOKEN_VERSION = 1;

/** A verified login session; transport-agnostic (the API server owns the cookie). */
export interface AuthSession {
  subject: string;
  method: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

interface TokenPayload {
  v: number;
  sub: string;
  method: string;
  iat: number;
  exp: number;
}

/**
 * Signing key for session tokens: `AUTH_SESSION_SECRET` when set, otherwise
 * derived from the global password — so rotating the password logs everyone
 * out. OIDC (later) will always need an explicit secret.
 */
function sessionSecret(config: AppConfig): Buffer | null {
  const material = config.auth.sessionSecret || config.auth.globalPassword;
  if (!material) return null;
  return createHash("sha256").update(`neuretina:session:${material}`).digest();
}

export function issueSessionToken(
  config: AppConfig,
  identity: AuthIdentity,
  ttlMs: number,
  now = Date.now(),
): string | null {
  const secret = sessionSecret(config);
  if (!secret) return null;
  const payload: TokenPayload = {
    v: TOKEN_VERSION,
    sub: identity.subject,
    method: identity.method,
    iat: now,
    exp: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

export function verifySessionToken(
  config: AppConfig,
  token: string | undefined,
  now = Date.now(),
): AuthSession | null {
  const secret = sessionSecret(config);
  if (!secret || !token) return null;

  const separator = token.lastIndexOf(".");
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!timingSafeStringEqual(signature, sign(encoded, secret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
    if (payload.v !== TOKEN_VERSION) return null;
    if (typeof payload.exp !== "number" || payload.exp <= now) return null;
    if (typeof payload.sub !== "string" || typeof payload.method !== "string") return null;
    return { subject: payload.sub, method: payload.method, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

function sign(encoded: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(encoded).digest("base64url");
}

function timingSafeStringEqual(first: string, second: string): boolean {
  const left = Buffer.from(first, "utf8");
  const right = Buffer.from(second, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
