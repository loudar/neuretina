import { describe, expect, test } from "bun:test";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { ZERO_PRICING } from "../src/core/cost/CostTracker.ts";
import { createLogger } from "../src/core/logger.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import { WorkflowRegistry } from "../src/core/workflow/Workflow.ts";
import type { WorkflowRunContext } from "../src/core/workflow/Workflow.ts";
import { WorkflowRunner } from "../src/core/workflow/WorkflowRunner.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import { WorkflowRunRepository } from "../src/domain/runs/WorkflowRunRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createKernel } from "../src/kernel/Kernel.ts";
import { stubWorkflow, testConfig } from "./support.ts";

const log = createLogger("test", { level: "error" });

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function setup() {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const statuses = new StatusHub();
  const workflows = new WorkflowRegistry({ bus, logger: log, statuses });
  const runs = new WorkflowRunRepository(db);
  const runner = new WorkflowRunner({
    workflows,
    runs,
    bus,
    logger: log,
    statuses,
    pricing: ZERO_PRICING,
  });
  return { bus, workflows, runs, runner };
}

function blockingWorkflow(ready: () => void) {
  return stubWorkflow({
    id: "slow",
    description: "test workflow",
    run: async (_input: unknown, context: WorkflowRunContext): Promise<{ ok: boolean }> => {
      ready();
      await new Promise<void>((resolve) => {
        if (context.signal?.aborted) {
          resolve();
          return;
        }
        context.signal?.addEventListener("abort", () => resolve(), { once: true });
      });
      context.signal?.throwIfAborted();
      return { ok: true };
    },
  });
}

describe("run cancellation", () => {
  test("cancel aborts the workflow and settles the run as cancelled", async () => {
    const { bus, workflows, runs, runner } = setup();
    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    let ready!: () => void;
    const readyPromise = new Promise<void>((resolve) => {
      ready = resolve;
    });
    workflows.register(blockingWorkflow(ready));

    const promise = runner.start({ workflow: "slow", trigger: "manual", runId: "run-cancel-1" });
    await readyPromise;
    expect(await runner.cancel("run-cancel-1")).toBe(true);

    const finished = await promise;
    expect(finished.status).toBe("cancelled");
    expect(finished.output).toMatchObject({ cancelled: true });
    expect(events.some((event) => event.topic === "workflow.cancelled")).toBe(true);
    expect(events.some((event) => event.topic === "workflow.failed")).toBe(false);
    expect(runs.get("run-cancel-1").status).toBe("cancelled");
  });

  test("cancelling an unknown or finished run is a no-op", async () => {
    const { workflows, runner } = setup();
    workflows.register(stubWorkflow({ id: "fast", run: async () => ({ ok: true }) }));

    expect(await runner.cancel("nope")).toBe(false);
    await runner.start({ workflow: "fast", trigger: "manual", runId: "run-done-1" });
    expect(await runner.cancel("run-done-1")).toBe(false);
  });
});

describe("run resume", () => {
  test("resume executes a persisted run with its checkpoint and persists new ones", async () => {
    const { bus, workflows, runs, runner } = setup();
    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const resumes: unknown[] = [];
    workflows.register(
      stubWorkflow({
        id: "checkpointed",
        run: async (_input, context) => {
          resumes.push(context.resume);
          context.checkpoint?.({ step: 2 });
          return { ok: true, step: 2 };
        },
      }),
    );

    const run = runs.create({
      id: "run-resume-1",
      workflow: "checkpointed",
      contextId: "morning-briefing",
      trigger: "manual",
      input: { hello: "world" },
    });
    runs.saveCheckpoint(run.id, { step: 1 });

    const finished = await runner.resume(runs.get(run.id));

    expect(resumes).toEqual([{ step: 1 }]);
    expect(finished.status).toBe("succeeded");
    expect(finished.output).toEqual({ ok: true, step: 2 });
    expect(runs.get(run.id).checkpoint).toEqual({ step: 2 });
    // The existing run was executed, not duplicated.
    expect(runs.list()).toHaveLength(1);
    expect(events.some((event) => event.topic === "workflow.started")).toBe(true);
    expect(events.some((event) => event.topic === "workflow.finished")).toBe(true);
  });

  test("cancelling an orphaned persisted run settles it and deletes it", async () => {
    const kernel = await createKernel({ config: testConfig() });
    try {
      const run = kernel.runs.create({
        id: "run-orphan-cancel",
        workflow: "briefing",
        contextId: "morning-briefing",
        trigger: "manual",
      });
      const artifact = kernel.artifacts.create({
        kind: "note",
        contentType: "text/plain",
        content: "partial output",
        workflow: "briefing",
        correlationId: run.id,
      });

      await kernel.commands.execute("workflow.run.cancel", { id: run.id }, "test-client");

      await waitUntil(() => !kernel.runs.list().some((entry) => entry.id === run.id));
      expect(() => kernel.artifacts.get(artifact.id)).toThrow();
    } finally {
      await kernel.shutdown();
    }
  });

  test("resumeInterrupted resumes persisted running runs and fails unknown workflows", async () => {
    const { workflows, runs, runner } = setup();
    const resumed: string[] = [];

    workflows.register(
      stubWorkflow({
        id: "known",
        run: async (_input, context) => {
          resumed.push(context.correlationId);
          return { ok: true };
        },
      }),
    );

    const known = runs.create({
      id: "run-known-1",
      workflow: "known",
      contextId: "morning-briefing",
      trigger: "manual",
    });
    const orphan = runs.create({
      id: "run-orphan-1",
      workflow: "gone",
      contextId: "morning-briefing",
      trigger: "manual",
    });
    const done = runs.create({
      id: "run-done-1",
      workflow: "known",
      contextId: "morning-briefing",
      trigger: "manual",
    });
    runs.finish(done.id, { status: "succeeded" });

    expect(await runner.resumeInterrupted()).toBe(1);

    await waitUntil(() => runs.get(known.id).status !== "running");
    expect(resumed).toEqual([known.id]);
    expect(runs.get(orphan.id)).toMatchObject({
      status: "failed",
      error: "Workflow is no longer registered",
    });
    expect(runs.get(done.id).status).toBe("succeeded");
  });
});
