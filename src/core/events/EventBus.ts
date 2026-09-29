import type { Logger } from "../logger.ts";
import type { EventStore } from "./EventStore.ts";
import type { AppEvents } from "./AppEvents.ts";
import type { DomainEvent, EventHandler, EventInput } from "./types.ts";

interface Subscription {
  pattern: string;
  handler: EventHandler;
}

export interface PublishOptions {
  source: string;
  correlationId?: string;
}

type KnownTopic = keyof AppEvents;

export class EventBus {
  private readonly subscriptions = new Set<Subscription>();

  constructor(
    private readonly store: EventStore,
    private readonly logger: Logger,
  ) {}

  publish<K extends KnownTopic>(topic: K, payload: AppEvents[K], options: PublishOptions): DomainEvent<AppEvents[K]>;
  publish(topic: string, payload: unknown, options: PublishOptions): DomainEvent;
  publish(input: EventInput): DomainEvent;
  publish(
    topicOrInput: string | EventInput,
    payload?: unknown,
    options?: PublishOptions,
  ): DomainEvent {
    const input: EventInput =
      typeof topicOrInput === "string"
        ? {
            topic: topicOrInput,
            payload,
            source: options?.source ?? "unknown",
            correlationId: options?.correlationId,
          }
        : topicOrInput;

    const event = this.store.append(input);
    this.dispatch(event);
    return event;
  }

  subscribe(pattern: string, handler: EventHandler): () => void {
    const subscription: Subscription = { pattern, handler };
    this.subscriptions.add(subscription);
    return () => {
      this.subscriptions.delete(subscription);
    };
  }

  subscribeTopics(topics: string[], handler: EventHandler): () => void {
    const unsubscribers = topics.map((topic) => this.subscribe(topic, handler));
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }

  replayAfter(seq: number, limit?: number): DomainEvent[] {
    return this.store.readAfter(seq, limit);
  }

  private dispatch(event: DomainEvent): void {
    for (const subscription of this.subscriptions) {
      if (!matches(subscription.pattern, event.topic)) continue;
      try {
        const result = subscription.handler(event);
        if (result instanceof Promise) {
          result.catch((error) => {
            this.logger.error("event handler failed", {
              topic: event.topic,
              pattern: subscription.pattern,
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }
      } catch (error) {
        this.logger.error("event handler failed", {
          topic: event.topic,
          pattern: subscription.pattern,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export function matches(pattern: string, topic: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith(".*")) {
    return topic.startsWith(pattern.slice(0, -1));
  }
  return pattern === topic;
}
