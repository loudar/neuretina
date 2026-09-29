import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createKernel, type Kernel } from "../src/kernel/Kernel.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import {
  StubMessaging,
  StubTts,
  completion,
  stubLlm,
  stubSearch,
  testConfig,
  waitForEvent,
} from "./support.ts";

let kernel: Kernel;
let base: string;

beforeAll(async () => {
  kernel = await createKernel({
    config: testConfig(),
    logger: createLogger("test", { level: "error" }),
    llm: stubLlm(() => completion("ok")),
    webSearch: stubSearch("perplexity", "web"),
    socialSearch: stubSearch("bluesky", "social"),
    tts: new StubTts(),
    messaging: new StubMessaging(),
  });
  base = `http://127.0.0.1:${kernel.api.port}`;
});

afterAll(async () => {
  await kernel.shutdown();
});

interface WebhookResponse<T = unknown> {
  ok: boolean;
  type?: string;
  correlationId?: string;
  result?: T;
  error?: string;
  code?: string;
}

async function post(message: unknown): Promise<{ status: number; body: WebhookResponse }> {
  const response = await fetch(`${base}/api/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });
  let body: WebhookResponse = { ok: response.ok };
  try {
    body = (await response.json()) as WebhookResponse;
  } catch {
    // no body
  }
  return { status: response.status, body };
}

async function call<T>(type: string, payload?: unknown): Promise<T> {
  const { status, body } = await post({ type, payload });
  expect(status).toBe(200);
  return body.result as T;
}

describe("webhook gateway", () => {
  test("exposes only the webhook and static files", async () => {
    const probe = await fetch(`${base}/api/webhook`);
    expect(probe.status).toBe(200);
    const body = (await probe.json()) as { ok: boolean; commands: string[] };
    expect(body.ok).toBe(true);
    expect(body.commands).toContain("topic.create");
    expect(body.commands).toContain("event.wait");
    expect(body.commands).toContain("event.pull");

    expect((await fetch(`${base}/api/events`)).status).toBe(404);
    expect((await fetch(`${base}/api/topics`)).status).toBe(404);
    expect((await fetch(`${base}/api/health`)).status).toBe(404);
    expect((await fetch(`${base}/api/jobs`)).status).toBe(404);
  });

  test("rejects malformed bodies and missing types", async () => {
    const notJson = await fetch(`${base}/api/webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "definitely not json",
    });
    expect(notJson.status).toBe(400);

    const noType = await post({ payload: {} });
    expect(noType.status).toBe(400);
  });

  test("round-trips topic lifecycle commands synchronously", async () => {
    const created = await call<{ id: string; name: string }>("topic.create", {
      name: "Webhook topic",
      description: "via gateway",
    });
    expect(created.name).toBe("Webhook topic");

    const listed = await call<Array<{ id: string }>>("topic.list");
    expect(listed.some((topic) => topic.id === created.id)).toBe(true);

    await call("topic.delete", { id: created.id });
    const after = await call<Array<{ id: string }>>("topic.list");
    expect(after.some((topic) => topic.id === created.id)).toBe(false);
  });

  test("returns handler validation errors with proper status codes", async () => {
    const invalidTopic = await post({ type: "topic.create", payload: { name: "   " } });
    expect(invalidTopic.status).toBe(400);
    expect(invalidTopic.body.error).toContain("name");

    const invalidCron = await post({
      type: "job.create",
      payload: { name: "bad job", cron: "not-a-cron", workflow: "briefing" },
    });
    expect(invalidCron.status).toBe(400);
    expect(invalidCron.body.error).toContain("Invalid cron");
  });

  test("reports unknown message types with 404", async () => {
    const { status, body } = await post({ type: "does.not.exist" });
    expect(status).toBe(404);
    expect(body.error).toContain("Unknown message type");
  });

  test("records write commands and failures on the event bus", async () => {
    const completed = waitForEvent(
      kernel.bus,
      "command.completed",
      (event) => (event.payload as { type: string }).type === "topic.create",
    );
    const created = await call<{ id: string }>("topic.create", { name: "Audit topic" });
    await completed;
    await call("topic.delete", { id: created.id });

    // Read-only commands are quiet: they must not add audit events.
    const before = kernel.bus.replayAfter(0, 5000).length;
    await call("topic.list");
    await call("config.get");
    expect(kernel.bus.replayAfter(0, 5000).length).toBe(before);

    const failed = waitForEvent(
      kernel.bus,
      "command.failed",
      (event) => (event.payload as { type: string }).type === "does.not.exist",
    );
    await post({ type: "does.not.exist" });
    const failure = await failed;
    expect((failure.payload as { error: string }).error).toContain("Unknown message type");
  });

  test("manages jobs through the gateway", async () => {
    const job = await call<{ id: string; enabled: boolean }>("job.create", {
      name: "webhook job",
      cron: "0 6 * * *",
      workflow: "briefing",
    });
    expect(job.enabled).toBe(true);

    const run = await call<{ started: boolean }>("job.run", { id: job.id });
    expect(run.started).toBe(true);

    const jobs = await call<Array<{ id: string }>>("job.list");
    expect(jobs.some((entry) => entry.id === job.id)).toBe(true);

    await call("job.delete", { id: job.id });
  });

  test("routes hook.* messages to their bus topics", async () => {
    const received = waitForEvent(kernel.bus, "hook.deploy");
    const { status, body } = await post({
      type: "hook.deploy",
      payload: { event: "finished", status: "ok" },
    });
    expect(status).toBe(202);
    expect(body.ok).toBe(true);

    const event = await received;
    expect(event.payload).toMatchObject({ channel: "deploy", event: "finished" });
  });

  test("lists workflows and runs one through the gateway", async () => {
    const workflows = await call<Array<{ id: string }>>("workflow.list");
    expect(workflows.some((workflow) => workflow.id === "briefing")).toBe(true);

    // No topics exist at this point, so the run skips. Subscribe before
    // sending, because the workflow starts synchronously with the command.
    const skipped = waitForEvent(kernel.bus, "brief.skipped");

    const started = await call<{ started: boolean }>("workflow.run", {
      id: "briefing",
      input: {},
    });
    expect(started.started).toBe(true);

    await skipped;
  });

  test("event.pull returns persisted history", async () => {
    const events = await call<DomainEvent[]>("event.pull", { since: 0, limit: 500 });
    const topics = events.map((event) => event.topic);
    expect(topics).toContain("message.received");
    expect(topics).toContain("topic.created");
    expect(topics).toContain("hook.deploy");
  });

  test("event.wait returns immediately when there is a backlog", async () => {
    const events = await call<DomainEvent[]>("event.wait", { since: 0, timeoutMs: 1000 });
    expect(events.length).toBeGreaterThan(0);
  });

  test("event.wait wakes up when a new event arrives", async () => {
    const since = kernel.bus.replayAfter(0, 5000).at(-1)?.seq ?? 0;

    const pending = call<DomainEvent[]>("event.wait", { since, timeoutMs: 5000 });

    // Publish repeatedly so at least one event lands after the server has
    // subscribed, regardless of request scheduling jitter.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      kernel.bus.publish("test.wake", { attempt: i }, { source: "test" });
    }

    const events = await pending;
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.seq > since)).toBe(true);
  });

  test("event.wait returns an empty list after its timeout", async () => {
    const since = kernel.bus.replayAfter(0, 5000).at(-1)?.seq ?? 0;
    const started = Date.now();

    const events = await call<DomainEvent[]>("event.wait", { since, timeoutMs: 400 });

    expect(events).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
  });
});
