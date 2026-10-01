import { connection, type ConnectionFrame } from "./connection.svelte";
import type { StatusEntry, StatusState } from "./statusTypes";

export type { StatusEntry, StatusState };

const MAX_ENTRIES = 100;

/**
 * Live status feed over the shared WebSocket: server-push, ephemeral,
 * re-synced via a snapshot on every connect.
 */
export class StatusFeed {
  entries = $state<StatusEntry[]>([]);

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
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    connection.stop();
  }

  private handleFrame(frame: ConnectionFrame): void {
    if (frame.type === "snapshot") {
      this.entries = frame.entries.slice(-MAX_ENTRIES);
    } else if (frame.type === "entry") {
      this.upsert(frame.entry);
    }
  }

  private upsert(entry: StatusEntry): void {
    const index = this.entries.findIndex((existing) => existing.id === entry.id);
    if (index === -1) {
      this.entries = [...this.entries, entry].slice(-MAX_ENTRIES);
      return;
    }
    const next = [...this.entries];
    next[index] = entry;
    this.entries = next;
  }
}

export const statusFeed = new StatusFeed();
