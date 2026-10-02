import { describe, expect, test } from "bun:test";
import { flattenStatusEntries, orderStatusEntries } from "../web/src/lib/statusOrder.ts";
import type { StatusEntry } from "../web/src/lib/statusTypes.ts";

function entry(partial: Partial<StatusEntry> & { id: string }): StatusEntry {
  return { activityId: "a", text: "t", state: "done", startedAt: 0, updatedAt: 0, ...partial };
}

function orderedIds(entries: StatusEntry[]): string[] {
  return flattenStatusEntries(orderStatusEntries(entries)).map((item) => item.id);
}

function orderedDepths(entries: StatusEntry[]): string[] {
  return flattenStatusEntries(orderStatusEntries(entries)).map((item) => `${item.id}:${item.depth}`);
}

describe("orderStatusEntries", () => {
  test("orders running and settled entries chronologically", () => {
    const ordered = orderedIds([
      entry({ id: "run-late", state: "running", startedAt: 30 }),
      entry({ id: "done-1", state: "done", startedAt: 5, updatedAt: 20 }),
      entry({ id: "run-early", state: "running", startedAt: 10 }),
      entry({ id: "failed-1", state: "failed", startedAt: 6, updatedAt: 22 }),
    ]);

    expect(ordered).toEqual(["done-1", "failed-1", "run-early", "run-late"]);
  });

  test("keeps entries stable when their text updates", () => {
    const before = orderedIds([
      entry({ id: "r1", state: "running", startedAt: 10, updatedAt: 10 }),
      entry({ id: "r2", state: "running", startedAt: 20, updatedAt: 20 }),
      entry({ id: "d1", state: "done", startedAt: 1, updatedAt: 5 }),
    ]);

    const after = orderedIds([
      entry({ id: "r1", state: "running", startedAt: 10, updatedAt: 99 }),
      entry({ id: "r2", state: "running", startedAt: 20, updatedAt: 20 }),
      entry({ id: "d1", state: "done", startedAt: 1, updatedAt: 5 }),
    ]);

    expect(after).toEqual(before);
    expect(after).toEqual(["d1", "r1", "r2"]);
  });

  test("breaks start-time ties by id", () => {
    const ordered = orderedIds([
      entry({ id: "b", state: "done", startedAt: 1, updatedAt: 30 }),
      entry({ id: "a", state: "done", startedAt: 1, updatedAt: 10 }),
    ]);

    expect(ordered).toEqual(["a", "b"]);
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

  test("nests children under their parent and keeps execution order", () => {
    const ordered = orderStatusEntries([
      entry({ id: "research", state: "running", startedAt: 10, activityId: "research" }),
      entry({ id: "tool", state: "running", startedAt: 30, parentId: "research" }),
      entry({ id: "reasoning", state: "done", startedAt: 20, updatedAt: 25, parentId: "research" }),
      entry({ id: "other", state: "running", startedAt: 15 }),
    ]);

    expect(ordered.map((item) => item.id)).toEqual(["research", "other"]);
    expect(ordered[0]?.children.map((item) => item.id)).toEqual(["reasoning", "tool"]);
    expect(ordered[0]?.children.every((item) => item.depth === 1)).toBe(true);
  });

  test("supports deeper nesting", () => {
    const entries = [
      entry({ id: "root", state: "running", startedAt: 1 }),
      entry({ id: "child", state: "running", startedAt: 2, parentId: "root" }),
      entry({ id: "grandchild", state: "running", startedAt: 3, parentId: "child" }),
    ];

    const ordered = orderStatusEntries(entries);
    expect(ordered[0]?.children[0]?.children[0]?.id).toBe("grandchild");
    expect(orderedDepths(entries)).toEqual(["root:0", "child:1", "grandchild:2"]);
  });

  test("treats an orphaned child as a top-level entry", () => {
    const ordered = orderedIds([
      entry({ id: "orphan", parentId: "missing", state: "done", updatedAt: 5 }),
      entry({ id: "root", state: "done", updatedAt: 10 }),
    ]);

    expect(ordered).toEqual(["orphan", "root"]);
  });
});
