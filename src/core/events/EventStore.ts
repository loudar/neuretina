import type { SqliteDatabase } from "../../infra/db/SqliteDatabase.ts";
import type { DomainEvent, EventInput } from "./types.ts";

interface EventRow {
  seq: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  correlation_id: string | null;
  payload: string;
}

/** Storage-agnostic event log; the EventBus only needs this interface. */
export interface EventLog {
  append(input: EventInput): DomainEvent;
  readAfter(seq: number, limit?: number): DomainEvent[];
  latest(limit?: number): DomainEvent[];
  count(): number;
}

export class EventStore implements EventLog {
  constructor(private readonly db: SqliteDatabase) {}

  append(input: EventInput): DomainEvent {
    const event: DomainEvent = {
      seq: 0,
      id: input.id ?? crypto.randomUUID(),
      topic: input.topic,
      ts: input.ts ?? Date.now(),
      source: input.source,
      correlationId: input.correlationId,
      payload: input.payload,
    };

    const result = this.db.raw
      .query(
        `INSERT INTO events (id, topic, ts, source, correlation_id, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.topic,
        event.ts,
        event.source,
        event.correlationId ?? null,
        JSON.stringify(event.payload ?? null),
      );

    event.seq = Number(result.lastInsertRowid);
    return event;
  }

  readAfter(seq: number, limit = 1000): DomainEvent[] {
    const rows = this.db.raw
      .query<EventRow, [number, number]>(
        `SELECT * FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?`,
      )
      .all(seq, limit);
    return rows.map(toDomainEvent);
  }

  latest(limit = 100): DomainEvent[] {
    const rows = this.db.raw
      .query<EventRow, [number]>(
        `SELECT * FROM (SELECT * FROM events ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC`,
      )
      .all(limit);
    return rows.map(toDomainEvent);
  }

  count(): number {
    const row = this.db.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events").get();
    return row?.n ?? 0;
  }
}

function toDomainEvent(row: EventRow): DomainEvent {
  return {
    seq: row.seq,
    id: row.id,
    topic: row.topic,
    ts: row.ts,
    source: row.source,
    correlationId: row.correlation_id ?? undefined,
    payload: JSON.parse(row.payload),
  };
}
