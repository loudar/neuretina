import { describe, expect, test } from "bun:test";
import { EventBus, matches } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";

function setup(): { bus: EventBus; store: EventStore } {
  const db = new SqliteDatabase(":memory:");
  const store = new EventStore(db);
  const logger = createLogger("test", { level: "error" });
  return { bus: new EventBus(store, logger), store };
}

describe("event pattern matching", () => {
  test("matches exact, wildcard and prefix patterns", () => {
    expect(matches("topic.created", "topic.created")).toBe(true);
    expect(matches("topic.created", "topic.deleted")).toBe(false);
    expect(matches("*", "anything.at.all")).toBe(true);
    expect(matches("agent.*", "agent.started")).toBe(true);
    expect(matches("agent.*", "agentic.started")).toBe(false);
  });
});

describe("EventBus", () => {
  test("publishes, persists and dispatches to subscribers", async () => {
    const { bus, store } = setup();
    const received: DomainEvent[] = [];

    bus.subscribe("topic.created", (event) => {
      received.push(event);
    });

    bus.publish("topic.created", { id: "1", name: "Rust" }, { source: "test" });

    expect(received).toHaveLength(1);
    expect(received[0]?.payload).toEqual({ id: "1", name: "Rust" });
    expect(received[0]?.seq).toBe(1);
    expect(store.count()).toBe(1);
  });

  test("supports wildcard and prefixed subscriptions with unsubscribe", async () => {
    const { bus } = setup();
    const topics: string[] = [];

    const unsubscribe = bus.subscribe("agent.*", (event) => {
      topics.push(event.topic);
    });
    bus.subscribe("*", (event) => {
      topics.push(`all:${event.topic}`);
    });

    bus.publish("agent.started", { agent: "researcher", correlationId: "c", input: "x" }, { source: "t" });
    unsubscribe();
    bus.publish("agent.finished", {
      agent: "researcher",
      correlationId: "c",
      steps: 1,
      durationMs: 5,
      output: "done",
    }, { source: "t" });

    expect(topics).toEqual(["agent.started", "all:agent.started", "all:agent.finished"]);
  });

  test("allows arbitrary topics for hooks", () => {
    const { bus } = setup();
    const seen: string[] = [];
    bus.subscribe("hook.*", (event) => seen.push(event.topic));

    bus.publish("hook.deploy", { channel: "deploy", event: "finished", payload: {} }, { source: "test" });

    expect(seen).toEqual(["hook.deploy"]);
  });

  test("replays persisted events after a sequence number", () => {
    const { bus } = setup();
    bus.publish("topic.created", { id: "1", name: "a" }, { source: "t" });
    bus.publish("topic.deleted", { id: "1", name: "a" }, { source: "t" });
    bus.publish("topic.created", { id: "2", name: "b" }, { source: "t" });

    const replayed = bus.replayAfter(1);
    expect(replayed).toHaveLength(2);
    expect(replayed[0]?.seq).toBe(2);
    expect(replayed[1]?.seq).toBe(3);
  });

  test("isolates subscriber failures from other subscribers", () => {
    const { bus } = setup();
    const seen: string[] = [];

    bus.subscribe("topic.created", () => {
      throw new Error("boom");
    });
    bus.subscribe("topic.created", (event) => {
      seen.push(event.topic);
    });

    expect(() => bus.publish("topic.created", { id: "1", name: "x" }, { source: "t" })).not.toThrow();
    expect(seen).toEqual(["topic.created"]);
  });
});
