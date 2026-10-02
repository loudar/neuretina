export interface DomainEvent<T = unknown> {
  seq: number;
  id: string;
  topic: string;
  ts: number;
  source: string;
  correlationId?: string;
  payload: T;
}

export interface EventInput<T = unknown> {
  topic: string;
  payload: T;
  source: string;
  correlationId?: string;
  ts?: number;
  id?: string;
}

export type EventHandler = (event: DomainEvent) => unknown;
