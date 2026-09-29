import { describe, expect, test } from "bun:test";
import { matchesPatterns, scanNewEvents } from "../web/src/lib/eventMatch.ts";
import type { DomainEvent } from "../web/src/lib/api.ts";

function event(seq: number, topic: string): DomainEvent {
  return { seq, id: `e${seq}`, topic, ts: seq, source: "test", payload: null };
}

describe("matchesPatterns", () => {
  test("supports exact and prefix patterns", () => {
    expect(matchesPatterns(["topic."], "topic.created")).toBe(true);
    expect(matchesPatterns(["topic."], "topical.created")).toBe(false);
    expect(matchesPatterns(["job.created"], "job.created")).toBe(true);
    expect(matchesPatterns(["job.created"], "job.updated")).toBe(false);
    expect(matchesPatterns(["a.", "b."], "b.thing")).toBe(true);
  });
});

describe("scanNewEvents", () => {
  test("finds a matching event even when it is not the last of the batch", () => {
    const batch = [
      event(1, "message.received"),
      event(2, "topic.created"),
      event(3, "command.completed"),
    ];

    const scan = scanNewEvents(batch, ["topic."], 0);

    expect(scan.matched).toBe(true);
    expect(scan.seenSeq).toBe(3);
  });

  test("ignores events that were already seen", () => {
    const batch = [
      event(1, "message.received"),
      event(2, "topic.created"),
      event(3, "command.completed"),
    ];

    const scan = scanNewEvents(batch, ["topic."], 2);

    expect(scan.matched).toBe(false);
    expect(scan.seenSeq).toBe(3);
  });

  test("returns false when nothing matches", () => {
    const scan = scanNewEvents([event(5, "message.received")], ["topic."], 0);
    expect(scan.matched).toBe(false);
    expect(scan.seenSeq).toBe(5);
  });

  test("advances the cursor across batches", () => {
    let seen = 0;
    const first = scanNewEvents([event(1, "message.received")], ["topic."], seen);
    seen = first.seenSeq;
    expect(first.matched).toBe(false);

    const second = scanNewEvents(
      [event(1, "message.received"), event(2, "topic.deleted")],
      ["topic."],
      seen,
    );
    expect(second.matched).toBe(true);
    expect(second.seenSeq).toBe(2);
  });
});
