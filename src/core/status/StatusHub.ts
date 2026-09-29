export type StatusState = "running" | "done" | "failed";

export interface StatusEntry {
  id: string;
  /** Groups entries that belong to the same running thing (parallel-safe). */
  activityId: string;
  correlationId?: string;
  /** Entry this one runs under (e.g. an agent step under its research span). */
  parentId?: string;
  text: string;
  detail?: string;
  state: StatusState;
  startedAt: number;
  updatedAt: number;
}

export type StatusMessage =
  | { type: "snapshot"; entries: StatusEntry[] }
  | { type: "entry"; entry: StatusEntry };

export interface StatusHandle {
  readonly id: string;
  update(text: string, detail?: string): void;
  done(text?: string, detail?: string): void;
  failed(text?: string, detail?: string): void;
}

export interface BeginStatusOptions {
  correlationId?: string;
  parentId?: string;
  detail?: string;
}

export interface PushStatusOptions extends BeginStatusOptions {
  state?: StatusState;
  activityId?: string;
}

/**
 * In-memory, ephemeral status feed for the UI. Entries are appended in
 * chronological order (newest last), updated in place while a step runs, and
 * settled to done/failed. Everything is broadcast to subscribers (WebSocket
 * clients) and can be replayed as a snapshot on connect.
 */
export class StatusHub {
  private readonly entries = new Map<string, StatusEntry>();
  private readonly listeners = new Set<(message: StatusMessage) => void>();
  private readonly maxEntries: number;

  constructor(options: { maxEntries?: number } = {}) {
    this.maxEntries = Math.max(10, options.maxEntries ?? 120);
  }

  begin(activityId: string, text: string, options: BeginStatusOptions = {}): StatusHandle {
    const entry = this.add(activityId, text, "running", options);
    return {
      id: entry.id,
      update: (nextText, detail) => this.settle(entry.id, "running", nextText, detail),
      done: (nextText, detail) => this.settle(entry.id, "done", nextText, detail),
      failed: (nextText, detail) => this.settle(entry.id, "failed", nextText, detail),
    };
  }

  /** Adds an already-settled entry (e.g. derived from a bus event). */
  push(text: string, options: PushStatusOptions = {}): StatusEntry {
    return this.add(
      options.activityId ?? `misc:${crypto.randomUUID()}`,
      text,
      options.state ?? "done",
      options,
    );
  }

  /** Marks all running entries of a correlation as failed (e.g. run crashed). */
  failRunning(correlationId: string, detail?: string): void {
    for (const entry of this.entries.values()) {
      if (entry.state !== "running" || entry.correlationId !== correlationId) continue;
      this.settle(entry.id, "failed", undefined, detail);
    }
  }

  snapshot(): StatusEntry[] {
    return [...this.entries.values()].map((entry) => ({ ...entry }));
  }

  snapshotMessage(): StatusMessage {
    return { type: "snapshot", entries: this.snapshot() };
  }

  subscribe(listener: (message: StatusMessage) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private add(
    activityId: string,
    text: string,
    state: StatusState,
    options: BeginStatusOptions,
  ): StatusEntry {
    const now = Date.now();
    const entry: StatusEntry = {
      id: crypto.randomUUID(),
      activityId,
      correlationId: options.correlationId,
      parentId: options.parentId,
      text,
      detail: options.detail,
      state,
      startedAt: now,
      updatedAt: now,
    };

    this.entries.set(entry.id, entry);
    this.trim();
    this.broadcast({ type: "entry", entry: { ...entry } });
    return entry;
  }

  private settle(
    id: string,
    state: StatusState,
    text: string | undefined,
    detail: string | undefined,
  ): void {
    const entry = this.entries.get(id);
    if (!entry) return;

    if (text !== undefined) entry.text = text;
    if (detail !== undefined) entry.detail = detail;
    entry.state = state;
    entry.updatedAt = Date.now();

    this.broadcast({ type: "entry", entry: { ...entry } });
  }

  private trim(): void {
    if (this.entries.size <= this.maxEntries) return;

    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      if (entry.state === "running") continue;
      this.entries.delete(id);
    }
  }

  private broadcast(message: StatusMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch {
        // a broken listener must not break the feed
      }
    }
  }
}
