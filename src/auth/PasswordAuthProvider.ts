import { timingSafeEqual } from "node:crypto";
import type { AuthIdentity, AuthProvider } from "./AuthProvider.ts";

/**
 * Simple global password: when `AUTH_GLOBAL_PASSWORD` is set, one shared
 * secret protects the whole site until per-user mechanisms (OIDC, …) land.
 */
export const passwordAuthProvider: AuthProvider = {
  id: "password",
  title: "Password",
  available: (config) => Boolean(config.auth.globalPassword),
  authenticate: (config, credentials) => {
    const expected = config.auth.globalPassword;
    if (!expected) return null;
    const supplied = typeof credentials.password === "string" ? credentials.password : "";
    if (!timingSafeStringEqual(supplied, expected)) return null;
    // The shared password logs in as the admin account, which owns the main
    // database; per-user mechanisms (OIDC, …) will resolve other accounts.
    const subject = config.auth.adminUsername || "admin";
    return { subject, method: "password", attributes: { scope: "global" } };
  },
};

function timingSafeStringEqual(first: string, second: string): boolean {
  const left = Buffer.from(first, "utf8");
  const right = Buffer.from(second, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
