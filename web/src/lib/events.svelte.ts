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
  private generation = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    const generation = ++this.generation;
    void this.loop(generation);
  }

  stop(): void {
    this.running = false;
    // Invalidate the in-flight loop: a later start() must not end up with two
    // loops appending the same batches (seen after dev-server remounts).
    this.generation += 1;
  }

  clear(): void {
    this.events = [];
  }

  private async loop(generation: number): Promise<void> {
    let backoff = 1000;

    while (this.running && generation === this.generation) {
      try {
        const batch = await send<DomainEvent[]>(
          "event.wait",
          { since: this.lastSeq, timeoutMs: WAIT_TIMEOUT_MS },
          WAIT_TIMEOUT_MS + 15_000,
        );

        if (generation !== this.generation) return;

        this.connected = true;
        backoff = 1000;

        // Never append an event we already have (defensive: seq is unique).
        const fresh = batch.filter((event) => event.seq > this.lastSeq);
        if (fresh.length > 0) {
          this.events = [...this.events, ...fresh].slice(-MAX_EVENTS);
          this.lastSeq = fresh[fresh.length - 1]!.seq;
        }
      } catch {
        if (generation !== this.generation) return;
        this.connected = false;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 10_000);
      }
    }

    if (generation === this.generation) this.connected = false;
  }
}

export const eventStream = new EventStream();
