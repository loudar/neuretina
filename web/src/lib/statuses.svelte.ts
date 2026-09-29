const MAX_ENTRIES = 100;
const RECONNECT_DELAY_MS = 2000;

export type StatusState = "running" | "done" | "failed";

export interface StatusEntry {
  id: string;
  activityId: string;
  correlationId?: string;
  text: string;
  detail?: string;
  state: StatusState;
  startedAt: number;
  updatedAt: number;
}

type StatusMessage =
  | { type: "snapshot"; entries: StatusEntry[] }
  | { type: "entry"; entry: StatusEntry };

/**
 * Live status feed over WebSocket (`/api/ws`): server-push, ephemeral,
 * reconnects automatically and re-syncs via a snapshot on every connect.
 */
export class StatusFeed {
  entries = $state<StatusEntry[]>([]);
  connected = $state(false);

  private socket: WebSocket | null = null;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }

  private connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.connected = true;
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message = JSON.parse(event.data) as StatusMessage;
        if (message.type === "snapshot") {
          this.entries = message.entries.slice(-MAX_ENTRIES);
        } else if (message.type === "entry") {
          this.upsert(message.entry);
        }
      } catch {
        // ignore malformed frames
      }
    };

    socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      if (!this.running) return;
      this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
    };

    socket.onerror = () => {
      socket.close();
    };
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
