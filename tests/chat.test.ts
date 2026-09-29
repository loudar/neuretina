import { describe, expect, test } from "bun:test";
import { createChatCommandHandler } from "../src/chat/ChatCommands.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import { Scheduler } from "../src/core/scheduler/Scheduler.ts";
import { WorkflowRegistry } from "../src/core/workflow/Workflow.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import type { Workflow } from "../src/core/workflow/Workflow.ts";
import { JobRepository } from "../src/domain/jobs/JobRepository.ts";
import { StubMessaging, testConfig } from "./support.ts";
import type { ChatCommand } from "../src/capabilities/chat/ChatChannel.ts";

const log = createLogger("test", { level: "error" });

function command(partial: Partial<ChatCommand>): ChatCommand {
  return {
    channel: "!room:test",
    sender: "@user:test",
    command: "help",
    args: "",
    raw: "/help",
    ...partial,
  };
}

function setup() {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const jobs = new JobRepository(db);
  const workflows = new WorkflowRegistry({ bus, logger: log, statuses: new StatusHub() });
  const messaging = new StubMessaging();
  const scheduler = new Scheduler({ jobs, workflows, bus, logger: log });

  const workflow: Workflow = {
    id: "briefing",
    description: "test workflow",
    run: async () => ({ ok: true }),
  };
  workflows.register(workflow);

  const handler = createChatCommandHandler({
    config: testConfig(),
    jobs,
    workflows,
    scheduler,
    messaging,
    bus,
    logger: log,
  });

  return { bus, jobs, workflows, messaging, scheduler, handler };
}

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition not met in time");
}

describe("chat commands", () => {
  test("/help explains the commands", async () => {
    const { handler } = setup();
    const reply = await handler(command({ command: "help" }));
    expect(reply).toContain("/start <task id or name>");
    expect(reply).toContain("/list");
  });

  test("unknown commands return help", async () => {
    const { handler } = setup();
    const reply = await handler(command({ command: "bogus" }));
    expect(reply).toContain('Unknown command "/bogus"');
  });

  test("/list shows tasks with ids and workflows", async () => {
    const { handler, jobs } = setup();
    jobs.create({ name: "morning-brief", cron: "0 7 * * *", workflow: "briefing" });

    const reply = await handler(command({ command: "list" }));
    expect(reply).toContain('"morning-brief"');
    expect(reply).toContain("cron 0 7 * * *");
    expect(reply).toContain("Workflows: briefing");
  });

  test("/start by name runs the job off schedule and reports completion", async () => {
    const { handler, jobs, messaging, scheduler } = setup();
    scheduler.stop();
    const job = jobs.create({ name: "morning-brief", cron: "0 7 * * *", workflow: "briefing" });

    const reply = await handler(command({ command: "start", args: "morning-brief" }));
    expect(reply).toContain(`Started job "morning-brief"`);

    await waitFor(() => messaging.sent.length >= 1);
    expect(messaging.sent[0]?.message.kind).toBe("text");
    if (messaging.sent[0]?.message.kind === "text") {
      expect(messaging.sent[0].message.text).toContain('Job "morning-brief" finished successfully');
    }

    expect(jobs.get(job.id).lastStatus).toBe("success");
  });

  test("/start by task id works too", async () => {
    const { handler, jobs } = setup();
    const job = jobs.create({ name: "other task", cron: "0 8 * * *", workflow: "briefing" });

    const reply = await handler(command({ command: "start", args: job.id }));
    expect(reply).toContain(`Started job "other task"`);
  });

  test("/start with a workflow id runs the workflow directly", async () => {
    const { handler, messaging } = setup();
    const reply = await handler(command({ command: "start", args: "briefing" }));
    expect(reply).toContain('Started workflow "briefing"');

    await waitFor(() => messaging.sent.length >= 1);
    if (messaging.sent[0]?.message.kind === "text") {
      expect(messaging.sent[0].message.text).toContain('Workflow "briefing" finished successfully');
    }
  });

  test("/start with an unknown target lists the options", async () => {
    const { handler } = setup();
    const reply = await handler(command({ command: "start", args: "nope" }));
    expect(reply).toContain('Nothing matches "nope"');
  });

  test("/status reports configuration state", async () => {
    const { handler } = setup();
    const reply = await handler(command({ command: "status" }));
    expect(reply).toContain("Configuration status");
    expect(reply).toContain("llm");
  });
});

