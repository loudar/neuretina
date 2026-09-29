import { describe, expect, test } from "bun:test";
import { orderStatusEntries } from "../web/src/lib/statusOrder.ts";
import type { StatusEntry } from "../web/src/lib/statusTypes.ts";

function entry(partial: Partial<StatusEntry> & { id: string }): StatusEntry {
  return { activityId: "a", text: "t", state: "done", startedAt: 0, updatedAt: 0, ...partial };
}

describe("orderStatusEntries", () => {
  test("groups all running entries at the bottom", () => {
    const ordered = orderStatusEntries([
      entry({ id: "run-early", state: "running", startedAt: 10 }),
      entry({ id: "done-1", state: "done", startedAt: 5, updatedAt: 20 }),
      entry({ id: "run-late", state: "running", startedAt: 30 }),
      entry({ id: "failed-1", state: "failed", startedAt: 6, updatedAt: 22 }),
    ]).map((item) => item.id);

    expect(ordered).toEqual(["done-1", "failed-1", "run-early", "run-late"]);
  });

  test("keeps parallel running entries stable when their text updates", () => {
    const before = orderStatusEntries([
      entry({ id: "r1", state: "running", startedAt: 10, updatedAt: 10 }),
      entry({ id: "r2", state: "running", startedAt: 20, updatedAt: 20 }),
      entry({ id: "d1", state: "done", startedAt: 1, updatedAt: 5 }),
    ]).map((item) => item.id);

    const after = orderStatusEntries([
      entry({ id: "r1", state: "running", startedAt: 10, updatedAt: 99 }),
      entry({ id: "r2", state: "running", startedAt: 20, updatedAt: 20 }),
      entry({ id: "d1", state: "done", startedAt: 1, updatedAt: 5 }),
    ]).map((item) => item.id);

    expect(after).toEqual(before);
    expect(after).toEqual(["d1", "r1", "r2"]);
  });

  test("orders settled history by settle time", () => {
    const ordered = orderStatusEntries([
      entry({ id: "late-settle", state: "done", startedAt: 1, updatedAt: 30 }),
      entry({ id: "early-settle", state: "done", startedAt: 2, updatedAt: 10 }),
    ]).map((item) => item.id);

    expect(ordered).toEqual(["early-settle", "late-settle"]);
  });

  test("does not mutate the input", () => {
    const input = [
      entry({ id: "running", state: "running", startedAt: 1 }),
      entry({ id: "done", state: "done", startedAt: 0, updatedAt: 2 }),
    ];
    const snapshot = input.map((item) => item.id);

    orderStatusEntries(input);

    expect(input.map((item) => item.id)).toEqual(snapshot);
  });

  test("indents children under their parent and keeps execution order", () => {
    const ordered = orderStatusEntries([
      entry({ id: "research", state: "running", startedAt: 10, activityId: "research" }),
      entry({ id: "tool", state: "running", startedAt: 30, parentId: "research" }),
      entry({ id: "reasoning", state: "done", startedAt: 20, updatedAt: 25, parentId: "research" }),
      entry({ id: "other", state: "running", startedAt: 15 }),
    ]);

    expect(ordered.map((item) => `${item.id}:${item.depth}`)).toEqual([
      "research:0",
      "reasoning:1",
      "tool:1",
      "other:0",
    ]);
  });

  test("treats an orphaned child as a top-level entry", () => {
    const ordered = orderStatusEntries([
      entry({ id: "orphan", parentId: "missing", state: "done", updatedAt: 5 }),
      entry({ id: "root", state: "done", updatedAt: 10 }),
    ]);

    expect(ordered.map((item) => `${item.id}:${item.depth}`)).toEqual(["orphan:0", "root:0"]);
  });
});

