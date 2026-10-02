import { describe, expect, test } from "bun:test";
import { StatusHub, type StatusEntry, type StatusStore } from "../src/core/status/StatusHub.ts";
import { StatusService } from "../src/status/StatusService.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createLogger } from "../src/core/logger.ts";
import { Agent } from "../src/agents/Agent.ts";
import type { Tool } from "../src/agents/Tool.ts";
import { completion, stubLlm } from "./support.ts";

const log = createLogger("test", { level: "error" });

describe("StatusHub", () => {
  test("tracks entries through begin/update/done and notifies subscribers", () => {
    const hub = new StatusHub();
    const messages: Array<{ type: string }> = [];
    hub.subscribe((message) => messages.push(message));

    const handle = hub.begin("activity-1", "Reasoning", { correlationId: "corr" });
    expect(hub.snapshot()).toHaveLength(1);
    expect(hub.snapshot()[0]).toMatchObject({ text: "Reasoning", state: "running" });

    handle.update("Waiting for the model");
    handle.done("Model answered");

    const entry = hub.snapshot()[0]!;
    expect(entry.text).toBe("Model answered");
    expect(entry.state).toBe("done");
    expect(entry.correlationId).toBe("corr");
    expect(messages.map((message) => message.type)).toEqual(["entry", "entry", "entry"]);
  });

  test("supports parallel activities in insertion order", () => {
    const hub = new StatusHub();
    const a = hub.begin("a", "Job A");
    hub.begin("b", "Job B");
    a.done("Job A done");

    const entries = hub.snapshot();
    expect(entries.map((entry) => entry.text)).toEqual(["Job A done", "Job B"]);
    expect(entries[0]!.state).toBe("done");
    expect(entries[1]!.state).toBe("running");
  });

  test("failRunning settles only matching running entries", () => {
    const hub = new StatusHub();
    hub.begin("a", "A", { correlationId: "c1" });
    hub.begin("b", "B", { correlationId: "c2" });

    hub.failRunning("c1", "boom");

    const entries = hub.snapshot();
    expect(entries[0]).toMatchObject({ state: "failed", detail: "boom" });
    expect(entries[1]).toMatchObject({ state: "running" });
  });

  test("addCost sums spend onto ancestors", () => {
    const hub = new StatusHub();
    const parent = hub.begin("parent", "Parent");
    const child = hub.begin("child", "Child", { parentId: parent.id });

    child.addCost(0.004);
    child.addCost(0);
    child.addCost(Number.NaN);

    const entries = hub.snapshot();
    expect(entries.find((entry) => entry.id === child.id)?.costUsd).toBeCloseTo(0.004, 6);
    expect(entries.find((entry) => entry.id === parent.id)?.costUsd).toBeCloseTo(0.004, 6);
  });

  test("trims old settled entries but keeps running ones", () => {
    const hub = new StatusHub({ maxEntries: 10 });
    const running = hub.begin("keep", "running");
    for (let i = 0; i < 20; i++) hub.push(`done ${i}`);

    const entries = hub.snapshot();
    expect(entries).toHaveLength(10);
    expect(entries.some((entry) => entry.id === running.id)).toBe(true);
  });

  test("persists entries through a store and restores them after a restart", () => {
    const saved = new Map<string, StatusEntry>();
    const store: StatusStore = {
      save: (entry) => {
        saved.set(entry.id, { ...entry });
      },
      load: () => [...saved.values()],
      removeByCorrelation: (correlationId) => {
        for (const [id, entry] of saved) {
          if (entry.correlationId === correlationId) saved.delete(id);
        }
      },
    };

    const hub = new StatusHub({ store });
    const handle = hub.begin("activity", "Running a thing", { correlationId: "run-1" });
    handle.update("Still running");
    handle.addCost(0.002);

    const persisted = [...saved.values()][0]!;
    expect(persisted.text).toBe("Still running");
    expect(persisted.costUsd).toBeCloseTo(0.002, 6);

    // A fresh hub after a restart restores the feed; anything that was still
    // running is shown as interrupted.
    const restored = new StatusHub({ store });
    restored.restore(store.load());
    const entry = restored.snapshot()[0]!;
    expect(entry.text).toBe("Still running");
    expect(entry.state).toBe("failed");
    expect(entry.detail).toBe("Interrupted by restart");
    expect(saved.get(entry.id)?.state).toBe("failed");

    // Deleting the run drops its entries from memory and storage.
    restored.removeByCorrelation("run-1");
    expect(restored.snapshot()).toHaveLength(0);
    expect(saved.size).toBe(0);
  });
});

describe("StatusService", () => {
  function setup() {
    const db = new SqliteDatabase(":memory:");
    const bus = new EventBus(new EventStore(db), log);
    const hub = new StatusHub();
    new StatusService({ bus, logger: log, hub });
    return { bus, hub };
  }

  test("maps the job lifecycle to a single running entry", () => {
    const { bus, hub } = setup();

    bus.publish(
      "job.started",
      { id: "j1", name: "morning-report", workflow: "briefing", trigger: "manual" },
      { source: "t", correlationId: "c1" },
    );
    expect(hub.snapshot()[0]).toMatchObject({
      text: 'Running job "morning-report" (manual)',
      state: "running",
    });

    bus.publish(
      "job.finished",
      { id: "j1", name: "morning-report", workflow: "briefing", durationMs: 5000 },
      { source: "t", correlationId: "c1" },
    );
    expect(hub.snapshot()).toHaveLength(1);
    expect(hub.snapshot()[0]).toMatchObject({
      text: 'Job "morning-report" finished (5s)',
      state: "done",
    });
  });

  test("records skips, compiled reports, failures and chat commands", () => {
    const { bus, hub } = setup();

    bus.publish("report.skipped", { correlationId: "c", reason: "No material found", topics: ["a"] }, { source: "t", correlationId: "c" });
    bus.publish("report.generated", { correlationId: "c", reportId: "b1", topics: ["a"], sources: 3, characters: 100 }, { source: "t", correlationId: "c" });
    bus.publish("workflow.failed", { workflow: "briefing", correlationId: "c", error: "x" }, { source: "t", correlationId: "c" });
    bus.publish("chat.command.received", { channel: "r", sender: "@u:x", command: "start", args: "j" }, { source: "t", correlationId: "c" });

    const entries = hub.snapshot();
    expect(entries.map((entry) => entry.state)).toEqual(["failed", "done", "failed", "done"]);
    expect(entries[1]!.text).toContain("Report compiled");
  });

  test("a failed workflow also fails its still-running entries", () => {
    const { bus, hub } = setup();
    hub.begin("span", "Waiting for the model", { correlationId: "c9" });
    bus.publish("workflow.failed", { workflow: "briefing", correlationId: "c9", error: "nope" }, { source: "t", correlationId: "c9" });

    const entries = hub.snapshot();
    expect(entries[0]).toMatchObject({ state: "failed", detail: "nope" });
    expect(entries[1]!.state).toBe("failed");
  });
});

describe("Agent status instrumentation", () => {
  test("keeps tool activity out of the status feed", async () => {
    const hub = new StatusHub();
    const seen: string[] = [];
    hub.subscribe((message) => {
      if (message.type === "entry") seen.push(message.entry.text);
    });

    const tool: Tool = {
      name: "web_search",
      description: "search",
      parameters: {},
      execute: async () => ({ results: ["r1"] }),
    };
    const llm = stubLlm((request) =>
      request.messages.some((message) => message.role === "tool")
        ? completion("Final notes")
        : completion("", [{ id: "call-1", name: "web_search", arguments: { query: "x" } }]),
    );

    const bus = new EventBus(new EventStore(new SqliteDatabase(":memory:")), log);
    const agent = new Agent({
      name: "researcher",
      systemPrompt: "s",
      llm,
      tools: [tool],
    });

    const result = await agent.run("input", { correlationId: "corr", bus, logger: log });

    expect(result.text).toBe("Final notes");
    expect(seen).toEqual([]);
    expect(hub.snapshot()).toEqual([]);
  });

  test("enforces the tool call budget", async () => {
    const tool: Tool = {
      name: "web_search",
      description: "search",
      parameters: {},
      execute: async () => ({ results: [] }),
    };
    const llm = stubLlm(() => completion("", [{ id: crypto.randomUUID(), name: "web_search", arguments: { query: "x" } }]));
    const bus = new EventBus(new EventStore(new SqliteDatabase(":memory:")), log);
    const agent = new Agent({
      name: "researcher",
      systemPrompt: "s",
      llm,
      tools: [tool],
      maxSteps: 3,
      maxToolCalls: 1,
    });

    const result = await agent.run("input", { correlationId: "corr", bus, logger: log });

    const errors = result.steps
      .flatMap((step) => step.invocations)
      .map((invocation) => invocation.error)
      .filter(Boolean);
    expect(errors.some((error) => error!.includes("budget"))).toBe(true);
  });
});
