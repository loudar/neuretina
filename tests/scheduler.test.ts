import { afterEach, describe, expect, test } from "bun:test";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { ZERO_PRICING } from "../src/core/cost/CostTracker.ts";
import { createLogger } from "../src/core/logger.ts";
import { Scheduler } from "../src/core/scheduler/Scheduler.ts";
import { WorkflowRegistry } from "../src/core/workflow/Workflow.ts";
import { WorkflowRunner } from "../src/core/workflow/WorkflowRunner.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import { JobRepository } from "../src/domain/jobs/JobRepository.ts";
import { WorkflowRunRepository } from "../src/domain/runs/WorkflowRunRepository.ts";
import type { Workflow } from "../src/core/workflow/Workflow.ts";
import { stubWorkflow } from "./support.ts";

const log = createLogger("test", { level: "error" });
let activeScheduler: Scheduler | null = null;

afterEach(() => {
  activeScheduler?.stop();
  activeScheduler = null;
});

function setup(workflow: Workflow) {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const workflows = new WorkflowRegistry({ bus, logger: log, statuses: new StatusHub() });
  workflows.register(workflow);
  const jobs = new JobRepository(db);
  const runs = new WorkflowRunRepository(db);
  const runner = new WorkflowRunner({
    workflows,
    runs,
    bus,
    logger: log,
    statuses: new StatusHub(),
    pricing: ZERO_PRICING,
  });
  const scheduler = new Scheduler({ jobs, runner, bus, logger: log });
  activeScheduler = scheduler;
  return { scheduler, jobs, bus, runs };
}

describe("cron validation", () => {
  test("accepts valid expressions and rejects invalid ones", () => {
    expect(() => Scheduler.validateCron("0 7 * * *")).not.toThrow();
    expect(() => Scheduler.validateCron("*/15 9-17 * * MON-FRI")).not.toThrow();
    expect(() => Scheduler.validateCron("@daily")).not.toThrow();
    expect(() => Scheduler.validateCron("not a cron")).toThrow(/Invalid cron/);
    expect(() => Scheduler.validateCron("0 0 30 2 *")).toThrow(/Invalid cron/);
  });
});

describe("Scheduler", () => {
  test("runs a job's workflow manually and records the result", async () => {
    const calls: unknown[] = [];
    const workflow: Workflow = stubWorkflow({
      id: "recording",
      description: "records input",
      run: async (input) => {
        calls.push(input);
        return { ok: true };
      },
    });

    const { scheduler, jobs, bus } = setup(workflow);
    const job = jobs.create({ name: "test job", cron: "0 7 * * *", workflow: "recording", input: { a: 1 } });

    const events: string[] = [];
    bus.subscribe("job.*", (event) => events.push(event.topic));

    await scheduler.runNow(job);

    expect(calls).toEqual([{ a: 1 }]);
    expect(jobs.get(job.id).lastStatus).toBe("success");
    expect(events).toEqual(["job.started", "job.finished"]);
  });

  test("records failures without throwing", async () => {
    const workflow: Workflow = stubWorkflow({
      id: "failing",
      description: "always fails",
      run: async () => {
        throw new Error("nope");
      },
    });

    const { scheduler, jobs } = setup(workflow);
    const job = jobs.create({ name: "failing job", cron: "0 7 * * *", workflow: "failing" });

    await expect(scheduler.runNow(job)).resolves.toBeUndefined();
    expect(jobs.get(job.id).lastStatus).toBe("failed");
  });

  test("registers enabled jobs and skips disabled ones", () => {
    const workflow: Workflow = stubWorkflow({
      id: "noop",
      description: "does nothing",
      run: async () => undefined,
    });

    const { scheduler, jobs } = setup(workflow);
    jobs.create({ name: "enabled", cron: "0 7 * * *", workflow: "noop", enabled: true });
    jobs.create({ name: "disabled", cron: "0 7 * * *", workflow: "noop", enabled: false });

    scheduler.reload();
    expect(scheduler.registeredCount).toBe(1);
  });
});

