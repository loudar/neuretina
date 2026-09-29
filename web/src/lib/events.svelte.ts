import { send, type DomainEvent } from "./api";

const MAX_EVENTS = 400;
const WAIT_TIMEOUT_MS = 25_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Event feed built purely on webhook calls: a continuous loop of
 * `event.wait` long-polls (plus `event.pull` semantics on the server side).
 */
export class EventStream {
  events = $state<DomainEvent[]>([]);
  connected = $state(false);
  lastSeq = $state(0);

  private running = false;

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  clear(): void {
    this.events = [];
  }

  private async loop(): Promise<void> {
    let backoff = 1000;

    while (this.running) {
      try {
        const batch = await send<DomainEvent[]>(
          "event.wait",
          { since: this.lastSeq, timeoutMs: WAIT_TIMEOUT_MS },
          WAIT_TIMEOUT_MS + 15_000,
        );

        this.connected = true;
        backoff = 1000;

        if (batch.length > 0) {
          this.events = [...this.events, ...batch].slice(-MAX_EVENTS);
          this.lastSeq = batch[batch.length - 1]!.seq;
        }
      } catch {
        this.connected = false;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 10_000);
      }
    }

    this.connected = false;
  }
}

export const eventStream = new EventStream();
