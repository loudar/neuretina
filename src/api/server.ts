import { join, normalize, resolve } from "node:path";
import type { AppConfig } from "../config/env.ts";
import type { AuthService, AuthSession } from "../auth/AuthService.ts";
import { RateLimiter } from "../auth/RateLimiter.ts";
import { AppError, NotFoundError, ValidationError, errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import type { Brief } from "../domain/briefs/BriefRepository.ts";
import { eventWaitTimeoutMs } from "../commands/registerCommands.ts";

export interface ApiDeps {
  config: AppConfig;
  auth: AuthService;
  logger: Logger;
  /** Control-plane bus: authentication activity is audited there. */
  bus: EventBus;
  /** Account that owns the main database; unauthenticated sites act as it. */
  adminUser: string;
  /** The logged-in account's runtime: its stores, feeds and command router. */
  runtimeFor(username: string): ApiRuntime;
  /** Resolves an anonymous brief share token across every account's data. */
  sharedBrief(token: string): SharedBriefResult | null;
}

/** A brief reachable through its anonymous share token. */
export interface SharedBriefResult {
  brief: Brief;
  audio(): { audio: Uint8Array; mimeType: string } | null;
}

/** The per-user slice the HTTP layer needs. */
export interface ApiRuntime {
  user: string;
  bus: EventBus;
  commands: CommandRouter;
  statuses: StatusHub;
  logger: Logger;
}

export interface ApiServer {
  port: number;
  stop(): void;
}

export interface InboundMessage {
  type?: unknown;
  payload?: unknown;
  correlationId?: unknown;
}

/** WebSocket data: which account's status feed this socket follows. */
interface WsData {
  user: string;
}

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const SESSION_COOKIE = "neuretina_session";
/** Login requests allowed per client address and minute. */
const LOGIN_RATE_LIMIT_PER_MINUTE = 5;
const LOGIN_RATE_WINDOW_MS = 60_000;
/** Keep-alive ping cadence for the status socket. */
const WS_KEEPALIVE_MS = 30_000;

export function createApiServer(deps: ApiDeps): ApiServer {
  const log = deps.logger.child("api");
  const loginLimiter = new RateLimiter(LOGIN_RATE_LIMIT_PER_MINUTE, LOGIN_RATE_WINDOW_MS);
  const statusSubscriptions = new Map<Bun.ServerWebSocket<WsData>, () => void>();

  const server = Bun.serve<WsData>({
    port: deps.config.port,
    hostname: "0.0.0.0",
    maxRequestBodySize: 32 * 1024 * 1024,
    routes: {
      // The login endpoints themselves stay reachable without a session.
      "/api/auth/status": {
        GET: guard((request) =>
          jsonResponse(deps.auth.status(readCookie(request, SESSION_COOKIE))),
        ),
      },
      "/api/auth/login": {
        POST: guard((request, server) => handleLogin(request, server, deps, loginLimiter)),
      },
      "/api/auth/logout": {
        POST: guard((request) => handleLogout(request, deps)),
      },

      // Anonymous, read-only brief access: the token in a delivery link is
      // the only credential, so these stay outside the session guard.
      "/api/share/brief/:token": {
        GET: guard((request: Bun.BunRequest<"/api/share/brief/:token">) =>
          handleSharedBrief(request, deps),
        ),
      },
      "/api/share/brief/:token/audio": {
        GET: guard((request: Bun.BunRequest<"/api/share/brief/:token/audio">) =>
          handleSharedBriefAudio(request, deps),
        ),
      },

      "/api/webhook": {
        // The bare probe stays public: it is the container healthcheck and
        // only advertises the service, while POSTs run commands.
        GET: () =>
          jsonResponse({
            ok: true,
            service: "neuretina",
            auth: deps.auth.enabled ? "required" : "open",
            ingress: "POST a message { type, payload?, correlationId? } to this path",
            commands: deps.runtimeFor(deps.adminUser).commands.list(),
          }),
        POST: guard((request: Bun.BunRequest<"/api/webhook">, server: Bun.Server<WsData>) => {
          const runtime = requestRuntime(request, deps);
          if (!runtime) return unauthorized();
          return processMessage(request, runtime, server);
        }),
      },

      "/api/ws": (request: Bun.BunRequest<"/api/ws">, server: Bun.Server<WsData>) => {
        const runtime = requestRuntime(request, deps);
        if (!runtime) return unauthorized();
        if (server.upgrade(request, { data: { user: runtime.user } })) return undefined;
        return jsonResponse({ error: "WebSocket upgrade required" }, 426);
      },

      "/api/*": () => jsonResponse({ error: "Not found" }, 404),

      "/*": (request: Request) => serveWeb(request, deps.config.webDist),
    },

    websocket: {
      // Bun closes idle sockets after 120s by default, but status pushes can
      // be minutes apart; disable that timeout and keep the connection warm
      // with pings so proxies do not drop it either.
      idleTimeout: 0,
      open(ws) {
        const runtime = deps.runtimeFor(ws.data.user);
        let unsubscribe: (() => void) | null = null;
        unsubscribe = runtime.statuses.subscribe((message) => {
          try {
            ws.send(JSON.stringify(message));
          } catch {
            unsubscribe?.();
          }
        });
        const keepAlive = setInterval(() => {
          try {
            ws.ping();
          } catch {
            // The close handler owns the cleanup.
          }
        }, WS_KEEPALIVE_MS);
        statusSubscriptions.set(ws, () => {
          clearInterval(keepAlive);
          unsubscribe?.();
        });
        ws.send(JSON.stringify(runtime.statuses.snapshotMessage()));
      },
      close(ws) {
        statusSubscriptions.get(ws)?.();
        statusSubscriptions.delete(ws);
      },
      message() {
        // The status feed is server-push only.
      },
    },

    fetch: (request: Request) => serveWeb(request, deps.config.webDist),

    error(error: Error) {
      log.error("unhandled server error", { error: errorMessage(error) });
      return jsonResponse({ error: "Internal server error" }, 500);
    },
  });

  log.info("webhook gateway listening", { port: server.port ?? deps.config.port });
  return {
    port: server.port ?? deps.config.port,
    stop: () => {
      for (const unsubscribe of statusSubscriptions.values()) unsubscribe();
      statusSubscriptions.clear();
      server.stop(true);
    },
  };
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

/** `Secure` only behind TLS: the proxy terminates it and forwards the scheme. */
function isSecureRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

function sessionCookieHeader(token: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${
    secure ? "; Secure" : ""
  }`;
}

function clearSessionCookieHeader(secure: boolean): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
    secure ? "; Secure" : ""
  }`;
}

function currentSession(request: Request, deps: ApiDeps): AuthSession | null {
  return deps.auth.verify(readCookie(request, SESSION_COOKIE));
}

function unauthorized(): Response {
  return jsonResponse({ ok: false, error: "Authentication required", code: "UNAUTHORIZED" }, 401);
}

/**
 * Resolves the runtime of the logged-in account; null means the request must
 * be rejected. With authentication disabled everything acts as the admin.
 */
function requestRuntime(request: Request, deps: ApiDeps): ApiRuntime | null {
  if (!deps.auth.enabled) return deps.runtimeFor(deps.adminUser);
  const session = currentSession(request, deps);
  if (!session) return null;
  return deps.runtimeFor(session.subject);
}

async function handleLogin(
  request: Request,
  server: Bun.Server<WsData>,
  deps: ApiDeps,
  loginLimiter: RateLimiter,
): Promise<Response> {
  const key = server.requestIP(request)?.address ?? "unknown";
  const rate = loginLimiter.take(key);
  if (!rate.allowed) {
    return jsonResponse(
      { ok: false, error: "Too many requests; try again shortly", code: "TOO_MANY_REQUESTS" },
      429,
      { "Retry-After": String(Math.ceil(rate.retryAfterMs / 1000)) },
    );
  }

  if (deps.auth.blocked(key)) {
    return jsonResponse(
      { ok: false, error: "Too many attempts; try again later", code: "TOO_MANY_ATTEMPTS" },
      429,
    );
  }

  const body = await readJson<{ method?: unknown; password?: unknown }>(request);
  const method = typeof body.method === "string" ? body.method : undefined;
  const result = deps.auth.login(method, body as Record<string, unknown>);
  if (!result) {
    deps.auth.recordFailure(key);
    deps.bus.publish("auth.login.failed", { method: method ?? "password" }, { source: "auth" });
    return jsonResponse({ ok: false, error: "Invalid credentials", code: "UNAUTHORIZED" }, 401);
  }

  deps.auth.clearFailures(key);
  deps.bus.publish(
    "auth.login",
    { method: result.session.method, subject: result.session.subject },
    { source: "auth" },
  );
  return new Response(
    JSON.stringify({
      ok: true,
      method: result.session.method,
      subject: result.session.subject,
      expiresAt: result.session.expiresAt,
    }),
    {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        "Set-Cookie": sessionCookieHeader(
          result.token,
          result.maxAgeSeconds,
          isSecureRequest(request),
        ),
      },
    },
  );
}

function handleLogout(request: Request, deps: ApiDeps): Response {
  const session = currentSession(request, deps);
  if (session) {
    deps.bus.publish(
      "auth.logout",
      { method: session.method, subject: session.subject },
      { source: "auth" },
    );
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...JSON_HEADERS, "Set-Cookie": clearSessionCookieHeader(isSecureRequest(request)) },
  });
}

/** Public payload for the read-only view; exactly what it renders. */
function handleSharedBrief(
  request: Bun.BunRequest<"/api/share/brief/:token">,
  deps: ApiDeps,
): Response {
  const found = deps.sharedBrief(request.params.token);
  if (!found) return jsonResponse({ ok: false, error: "Brief not found" }, 404);
  const { brief } = found;
  return jsonResponse({
    ok: true,
    brief: {
      id: brief.id,
      createdAt: brief.createdAt,
      topics: brief.topics,
      markdown: brief.markdown,
      narration: brief.narration,
      sources: brief.sources,
      hasAudio: brief.hasAudio,
      audioMime: brief.audioMime,
      audioDurationMs: brief.audioDurationMs,
    },
  });
}

/** Audio of a shared brief, playable without a session. */
function handleSharedBriefAudio(
  request: Bun.BunRequest<"/api/share/brief/:token/audio">,
  deps: ApiDeps,
): Response {
  const audio = deps.sharedBrief(request.params.token)?.audio();
  if (!audio) return jsonResponse({ ok: false, error: "Audio not found" }, 404);
  return new Response(audio.audio, {
    headers: {
      "Content-Type": audio.mimeType,
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function processMessage(
  request: Request,
  runtime: ApiRuntime,
  server?: Bun.Server<WsData>,
): Promise<Response> {
  const message = await readJson<InboundMessage>(request);
  if (typeof message.type !== "string" || !message.type.trim()) {
    throw new ValidationError(`"type" must be a non-empty string`);
  }

  const type = message.type.trim();
  const correlationId =
    typeof message.correlationId === "string" && message.correlationId.trim()
      ? message.correlationId.trim()
      : crypto.randomUUID();
  const payload = message.payload ?? null;

  // Read-only commands are quiet: no audit events, so polling cannot feed itself.
  if (type.startsWith("hook.") || !runtime.commands.isQuiet(type)) {
    runtime.bus.publish(
      "message.received",
      { type, correlationId, payload },
      { source: "webhook", correlationId },
    );
  }

  // Fire-and-forget channels: forwarded to the bus, no reply.
  if (type.startsWith("hook.")) {
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
    const channel = type.slice("hook.".length);
    const event = typeof record.event === "string" ? record.event : "message";

    runtime.bus.publish(
      "hook.received",
      { channel, event },
      { source: `hook:${channel}`, correlationId },
    );
    runtime.bus.publish(
      `hook.${channel}`,
      { channel, event, payload },
      { source: `hook:${channel}`, correlationId },
    );

    return jsonResponse({ ok: true, accepted: true, type, correlationId }, 202);
  }

  // Long-polling event feed: give the request room beyond Bun's 10s idle
  // timeout (which counts time waiting for response bytes).
  if (type === "event.wait" && server) {
    server.timeout(request, Math.ceil(eventWaitTimeoutMs(payload) / 1000) + 5);
  }

  const result = await runtime.commands.execute(type, payload, correlationId);
  return jsonResponse({ ok: true, type, correlationId, result });
}

function guard<Path extends string>(
  handler: (
    request: Bun.BunRequest<Path>,
    server: Bun.Server<WsData>,
  ) => Promise<Response> | Response,
) {
  return async (
    request: Bun.BunRequest<Path>,
    server: Bun.Server<WsData>,
  ): Promise<Response> => {
    try {
      return await handler(request, server);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function errorResponse(error: unknown): Response {
  const message = errorMessage(error);
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";

  let status = 500;
  if (error instanceof ValidationError) status = 400;
  if (error instanceof NotFoundError) status = 404;
  if (code === "PROVIDER_ERROR") status = 502;

  if (status === 500) {
    console.error("[api] request failed:", error);
  }

  return jsonResponse({ ok: false, error: message, code }, status);
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

async function serveWeb(request: Request, webDist: string | null): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return jsonResponse({ error: "Not found" }, 404);
  }
  if (!webDist) {
    return jsonResponse(
      { error: "UI is not built. Run `bun run build:web` or use the Vite dev server." },
      404,
    );
  }

  const url = new URL(request.url);
  const requested = decodeURIComponent(url.pathname);
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const root = resolve(webDist);
  const candidate = resolve(root, normalize(relative));

  if (candidate.startsWith(root)) {
    const file = Bun.file(candidate);
    if (await file.exists()) {
      return new Response(file);
    }
  }

  const index = Bun.file(join(root, "index.html"));
  if (await index.exists()) {
    return new Response(index, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  return jsonResponse({ error: "Not found" }, 404);
}
