import { join, normalize, resolve } from "node:path";
import type { AppConfig } from "../config/env.ts";
import { AppError, NotFoundError, ValidationError, errorMessage } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import type { CommandRouter } from "../core/commands/CommandRouter.ts";
import type { StatusHub } from "../core/status/StatusHub.ts";
import { eventWaitTimeoutMs } from "../commands/registerCommands.ts";

export interface ApiDeps {
  config: AppConfig;
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

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };

export function createApiServer(deps: ApiDeps): ApiServer {
  const log = deps.logger.child("api");
  const statusClients = new Set<Bun.ServerWebSocket<undefined>>();

  const unsubscribeStatuses = deps.statuses.subscribe((message) => {
    const payload = JSON.stringify(message);
    for (const client of statusClients) {
      try {
        client.send(payload);
      } catch {
        statusClients.delete(client);
      }
    }
  });

  const server = Bun.serve({
    port: deps.config.port,
    hostname: "0.0.0.0",
    maxRequestBodySize: 32 * 1024 * 1024,
    routes: {
      "/api/webhook": {
        GET: () =>
          jsonResponse({
            ok: true,
            service: "briefing-engine",
            ingress: "POST a message { type, payload?, correlationId? } to this path",
            commands: deps.commands.list(),
          }),
        POST: guard((request: Bun.BunRequest<"/api/webhook">, server: Bun.Server<undefined>) =>
          processMessage(request, deps, server),
        ),
      },

      "/api/ws": (request: Bun.BunRequest<"/api/ws">, server: Bun.Server<undefined>) => {
        if (server.upgrade(request)) return undefined;
        return jsonResponse({ error: "WebSocket upgrade required" }, 426);
      },

      "/api/*": () => jsonResponse({ error: "Not found" }, 404),

      "/*": (request: Request) => serveWeb(request, deps.config.webDist),
    },

    websocket: {
      open(ws) {
        statusClients.add(ws);
        ws.send(JSON.stringify(deps.statuses.snapshotMessage()));
      },
      close(ws) {
        statusClients.delete(ws);
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
      unsubscribeStatuses();
      server.stop(true);
    },
  };
}

async function processMessage(
  request: Request,
  deps: ApiDeps,
  server?: Bun.Server<undefined>,
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
  if (type.startsWith("hook.") || !deps.commands.isQuiet(type)) {
    deps.bus.publish(
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

    deps.bus.publish("hook.received", { channel, event }, { source: `hook:${channel}`, correlationId });
    deps.bus.publish(
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

  const result = await deps.commands.execute(type, payload, correlationId);
  return jsonResponse({ ok: true, type, correlationId, result });
}

function guard<Path extends string>(
  handler: (
    request: Bun.BunRequest<Path>,
    server: Bun.Server<undefined>,
  ) => Promise<Response> | Response,
) {
  return async (
    request: Bun.BunRequest<Path>,
    server: Bun.Server<undefined>,
  ): Promise<Response> => {
    try {
      return await handler(request, server);
    } catch (error) {
      return errorResponse(error);
    }
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
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
