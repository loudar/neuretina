import { connection, type ConnectionFrame } from "./connection.svelte";
import type { DomainEvent } from "./api";

const MAX_EVENTS = 400;
/** Server-side `event.pull` page size; a full page means there is more. */
const PULL_LIMIT = 200;

/**
 * Event feed fed by the backend over the WebSocket: every persisted domain
 * event is pushed live, and each (re)connect backfills anything missed through
 * `event.pull`. No HTTP requests, no long-polling.
 */
export class EventStream {
  events = $state<DomainEvent[]>([]);
  lastSeq = $state(0);

  private running = false;
  private unsubscribe: (() => void) | null = null;

  get connected(): boolean {
    return connection.connected;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.unsubscribe = connection.subscribe((frame) => this.handleFrame(frame));
    connection.start();
    void this.sync();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    connection.stop();
  }

  clear(): void {
    this.events = [];
  }

  private handleFrame(frame: ConnectionFrame): void {
    if (frame.type === "event") {
      this.append([frame.event]);
      return;
    }
    // Re-sync on every (re)connect: events published while the socket was
    // down were never pushed.
    if (frame.type === "open") void this.sync();
  }

  private async sync(): Promise<void> {
    if (!this.running) return;
    try {
      // The pull endpoint pages; keep going until it returns a short page.
      for (;;) {
        const batch = await connection.request<DomainEvent[]>("event.pull", {
          since: this.lastSeq,
        });
        if (!this.running) return;
        this.append(batch);
        if (batch.length < PULL_LIMIT) return;
      }
    } catch {
      // The next (re)connect syncs again.
    }
  }

  private append(batch: DomainEvent[]): void {
    // Never append an event we already have (seq is unique and contiguous).
    const fresh = batch.filter((event) => event.seq > this.lastSeq);
    if (fresh.length === 0) return;
    fresh.sort((a, b) => a.seq - b.seq);
    this.events = [...this.events, ...fresh].slice(-MAX_EVENTS);
    this.lastSeq = fresh[fresh.length - 1]!.seq;
  }
}

export const eventStream = new EventStream();
