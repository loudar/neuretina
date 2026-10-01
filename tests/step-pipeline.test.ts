import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import type {
  StepContext,
  StepDefinition,
  WorkflowDefinition,
} from "../src/core/workflow/definition.ts";
import { StepPipeline, type PipelineState } from "../src/core/workflow/StepPipeline.ts";
import type { WorkflowRunContext } from "../src/core/workflow/Workflow.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";

const log = createLogger("test", { level: "error" });

function runContext(overrides: Partial<WorkflowRunContext> = {}): WorkflowRunContext {
  const db = new SqliteDatabase(":memory:");
  return {
    correlationId: "run-1",
    bus: new EventBus(new EventStore(db), log),
    logger: log,
    statuses: new StatusHub(),
    ...overrides,
  };
}

function definition(steps: StepDefinition[]): WorkflowDefinition {
  return { id: "test", title: "Test", description: "", triggers: [], inputs: [], steps };
}

function step(
  id: string,
  run: (ctx: StepContext) => Promise<unknown> | unknown,
  after?: string[],
): StepDefinition {
  return {
    id,
    type: id,
    title: id,
    ...(after ? { after } : {}),
    inputs: [],
    outputs: [],
    run: run as StepDefinition["run"],
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe("StepPipeline", () => {
  test("steps without after stay sequential", async () => {
    const order: string[] = [];
    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          order.push("a:start");
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push("a:end");
          return { outputs: { text: { text: "A" } } };
        }),
        step("b", async () => {
          order.push("b:start");
          order.push("b:end");
        }),
      ]),
    );

    await pipeline.run({ inputs: {}, options: {}, context: runContext() });
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  test("independent steps run concurrently and dependents wait", async () => {
    const events: string[] = [];
    const gateB = deferred();
    const gateC = deferred();

    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          events.push("a:end");
          return { outputs: { text: { text: "A" } } };
        }),
        step(
          "b",
          async () => {
            events.push("b:start");
            await gateB.promise;
            events.push("b:end");
          },
          ["a"],
        ),
        step(
          "c",
          async () => {
            events.push("c:start");
            await gateC.promise;
            events.push("c:end");
          },
          ["a"],
        ),
        step(
          "d",
          async () => {
            events.push("d:start");
            events.push("d:end");
          },
          ["b"],
        ),
      ]),
    );

    const promise = pipeline.run({ inputs: {}, options: {}, context: runContext() });
    // b and c share the same dependency and start together.
    await waitUntil(() => events.includes("b:start") && events.includes("c:start"));
    expect(events).not.toContain("d:start");

    // d only waits for its own dependency: it runs while c is still gated.
    gateB.resolve();
    await waitUntil(() => events.includes("d:end"));
    expect(events).not.toContain("c:end");

    gateC.resolve();
    await promise;
    expect(events).toContain("c:end");
  });

  test("handlers only see the outputs of their dependencies", async () => {
    const seen: Array<[string, string[]]> = [];
    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return { outputs: { text: { text: "A" } } };
        }),
        step(
          "b",
          async (ctx) => {
            seen.push(["b", [...ctx.outputs.keys()]]);
          },
          ["a"],
        ),
        step(
          "c",
          async (ctx) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            seen.push(["c", [...ctx.outputs.keys()]]);
          },
          [],
        ),
      ]),
    );

    await pipeline.run({ inputs: {}, options: {}, context: runContext() });
    expect(seen).toContainEqual(["b", ["a"]]);
    // c does not depend on a, so it never sees its output.
    expect(seen).toContainEqual(["c", []]);
  });

  test("a halt stops scheduling new steps", async () => {
    const ran: string[] = [];
    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          ran.push("a");
          return { halt: { skipped: true } };
        }),
        step("b", async () => {
          ran.push("b");
        }, ["a"]),
      ]),
    );

    const outcome = await pipeline.run({ inputs: {}, options: {}, context: runContext() });
    expect(outcome.halted).toEqual({ skipped: true });
    expect(ran).toEqual(["a"]);
  });

  test("resume restores completed steps without running them", async () => {
    const ran: string[] = [];
    let seen: unknown;
    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          ran.push("a");
          return { outputs: { text: { text: "fresh" } } };
        }),
        step(
          "b",
          async (ctx) => {
            ran.push("b");
            seen = ctx.outputs.get("a")?.text;
          },
          ["a"],
        ),
      ]),
    );

    const resume: PipelineState = { steps: { a: { text: { text: "saved" } } }, delivered: {} };
    const outcome = await pipeline.run({ inputs: {}, options: {}, context: runContext(), resume });

    expect(ran).toEqual(["b"]);
    expect(seen).toEqual({ text: "saved" });
    expect(outcome.outputs.get("a")?.text).toEqual({ text: "saved" });
  });

  test("a failing step waits for in-flight steps before rejecting", async () => {
    let finishedB = false;
    const gateB = deferred();
    const pipeline = new StepPipeline(
      definition([
        step("a", async () => {
          await new Promise((resolve) => setTimeout(resolve, 2));
          throw new Error("boom");
        }),
        step("b", async () => {
          await gateB.promise;
          finishedB = true;
        }, []),
      ]),
    );

    const promise = pipeline.run({ inputs: {}, options: {}, context: runContext() });
    const settled = promise.then(
      () => "resolved",
      () => "rejected",
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    // b is still running, so the failure has not surfaced yet.
    expect(await Promise.race([settled, Promise.resolve("pending")])).toBe("pending");

    gateB.resolve();
    await expect(promise).rejects.toThrow("boom");
    expect(finishedB).toBe(true);
  });
});
