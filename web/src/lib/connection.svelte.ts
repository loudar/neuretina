import { notifyUnauthorized } from "./authGate";
import type { DomainEvent } from "./api";
import type { StatusMessage } from "./statusTypes";

/** Frames the backend pushes over `/api/ws` (plus open/close notifications). */
export type ConnectionFrame =
  | { type: "open" }
  | { type: "close" }
  | StatusMessage
  | { type: "event"; event: DomainEvent };

/** A failed request, carrying the backend's error code when it has one. */
export class ConnectionError extends Error {
  readonly code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = "ConnectionError";
    this.code = code;
  }
}

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface OpenWaiter {
  resolve(): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const RECONNECT_DELAY_MS = 2000;

/**
 * The UI's single WebSocket to the backend. Commands are sent as
 * `{ id, type, payload }` frames and answered with `result` / `error` frames
 * keyed by id; status entries and domain events are pushed on the same socket.
 * Reconnects automatically while enabled.
 */
export class Connection {
  connected = $state(false);

  private socket: WebSocket | null = null;
  private enabled = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<(frame: ConnectionFrame) => void>();
  private openWaiters: OpenWaiter[] = [];

  start(): void {
    this.enabled = true;
    this.ensure();
  }

  stop(): void {
    this.enabled = false;
    this.disconnect(new ConnectionError("Disconnected"));
  }

  subscribe(listener: (frame: ConnectionFrame) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Runs a command over the socket and resolves with its result. */
  async request<T = unknown>(type: string, payload?: unknown, timeoutMs = 60_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    await this.waitForOpen(deadline);

    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new ConnectionError("Not connected");
    }

    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ConnectionError(`"${type}" timed out`));
      }, Math.max(1, deadline - Date.now()));

      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });

      try {
        socket.send(JSON.stringify({ id, type, payload }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new ConnectionError(String(error)));
      }
    });
  }

  private ensure(): void {
    if (!this.enabled || this.socket) return;
    this.connect();
  }

  private connect(): void {
    if (!this.enabled) return;

    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/ws`);
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.connected = true;
      this.flushOpenWaiters();
      this.emit({ type: "open" });
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      this.handleMessage(event.data);
    };

    socket.onclose = () => {
      // Ignore closes from sockets we already replaced (remounts, reconnects).
      if (this.socket !== socket) return;
      this.socket = null;
      this.connected = false;
      this.emit({ type: "close" });
      this.rejectPending(new ConnectionError("Connection lost"));
      if (!this.enabled) return;
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  private disconnect(reason: Error): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }

    this.connected = false;
    this.rejectPending(reason);
    for (const waiter of this.openWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(reason);
    }
    this.emit({ type: "close" });
  }

  private waitForOpen(deadline: number): Promise<void> {
    this.ensure();
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!this.enabled) {
      return Promise.reject(new ConnectionError("Not connected"));
    }

    return new Promise<void>((resolve, reject) => {
      const waiter: OpenWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.openWaiters = this.openWaiters.filter((entry) => entry !== waiter);
          reject(new ConnectionError("Connection timed out"));
        }, Math.max(1, deadline - Date.now())),
      };
      this.openWaiters.push(waiter);
    });
  }

  private flushOpenWaiters(): void {
    for (const waiter of this.openWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }

  private rejectPending(reason: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.reject(reason);
    }
  }

  private handleMessage(raw: string): void {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (!frame || typeof frame !== "object") return;

    const record = frame as { type?: unknown; id?: unknown; error?: unknown; code?: unknown };
    if (record.type === "result" || record.type === "error") {
      const pending = typeof record.id === "string" ? this.pending.get(record.id) : undefined;
      if (!pending) return;
      this.pending.delete(record.id as string);
      clearTimeout(pending.timer);

      if (record.type === "result") {
        pending.resolve((frame as { result?: unknown }).result);
        return;
      }

      const error = new ConnectionError(
        typeof record.error === "string" ? record.error : "Request failed",
        typeof record.code === "string" ? record.code : undefined,
      );
      if (error.code === "UNAUTHORIZED") notifyUnauthorized();
      pending.reject(error);
      return;
    }

    this.emit(frame as ConnectionFrame);
  }

  private emit(frame: ConnectionFrame): void {
    for (const listener of this.listeners) {
      try {
        listener(frame);
      } catch {
        // a broken listener must not break the socket
      }
    }
  }
}

export const connection = new Connection();
