import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createKernel, type Kernel } from "../src/kernel/Kernel.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import {
  StubDeliveryService,
  StubTts,
  completion,
  stubLlm,
  stubSearch,
  stubWorkflow,
  testConfig,
  waitForEvent,
} from "./support.ts";

let kernel: Kernel;
let base: string;
let delivery: StubDeliveryService;

beforeAll(async () => {
  delivery = new StubDeliveryService();
  kernel = await createKernel({
    config: testConfig(),
    logger: createLogger("test", { level: "error" }),
    llm: stubLlm(() => completion("ok")),
    webSearch: stubSearch("perplexity", "web"),
    socialSearch: stubSearch("bluesky", "social"),
    tts: new StubTts(),
    delivery,
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

async function waitUntil(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitUntil timed out");
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

    const updatedEvent = waitForEvent(
      kernel.bus,
      "topic.updated",
      (event) => (event.payload as { id: string }).id === created.id,
    );
    const updated = await call<{ name: string; description?: string }>("topic.update", {
      id: created.id,
      name: "Webhook topic v2",
      description: "updated context",
    });
    expect(updated.name).toBe("Webhook topic v2");
    expect(updated.description).toBe("updated context");
    await updatedEvent;

    const muted = await call<{ muted: boolean }>("topic.update", { id: created.id, muted: true });
    expect(muted.muted).toBe(true);

    const listed = await call<Array<{ id: string; name: string }>>("topic.list");
    expect(listed.some((topic) => topic.id === created.id && topic.name === "Webhook topic v2")).toBe(true);

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

  test("edits settings through the gateway with live effects", async () => {
    const list = await call<
      Array<{ key: string; source: string; value: string | null; stored: boolean }>
    >("settings.list");
    const model = list.find((setting) => setting.key === "LLM_MODEL");
    expect(model?.source).toBe("default");

    const updated = await call<{ source: string; value: string | null; stored: boolean }>(
      "settings.set",
      { key: "LLM_MODEL", value: "webhook-model" },
    );
    expect(updated.source).toBe("db");
    expect(updated.value).toBe("webhook-model");
    expect(updated.stored).toBe(true);

    const live = await call<{ llm: { model: string } }>("config.get");
    expect(live.llm.model).toBe("webhook-model");

    await call("settings.clear", { key: "LLM_MODEL" });
    const restored = await call<{ llm: { model: string } }>("config.get");
    expect(restored.llm.model).toBe("deepseek-v4.1-flash");
  });

  test("never persists secret setting values in the event log", async () => {
    await call("settings.set", { key: "OPENCODE_API_KEY", value: "sekrit-value" });
    await call("settings.clear", { key: "OPENCODE_API_KEY" });

    const log = JSON.stringify(kernel.bus.replayAfter(0, 5000));
    expect(log).not.toContain("sekrit-value");
    expect(log).toContain("settings.updated");
  });

  test("manages jobs through the gateway", async () => {
    const job = await call<{ id: string; enabled: boolean; input: Record<string, unknown> }>(
      "job.create",
      {
        name: "webhook job",
        cron: "0 6 * * *",
        workflow: "briefing",
        input: { generateAudio: false },
      },
    );
    expect(job.enabled).toBe(true);
    expect(job.input).toEqual({ generateAudio: false });

    const run = await call<{ started: boolean; runId: string }>("job.run", { id: job.id });
    expect(run.started).toBe(true);
    expect(run.runId).toBeTruthy();

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

    const started = await call<{ started: boolean; runId: string }>("workflow.run", {
      id: "briefing",
      input: {},
    });
    expect(started.started).toBe(true);
    expect(started.runId).toBeTruthy();

    // The run is persisted before the command returns, so it is linkable.
    const run = await call<{ id: string; workflow: string }>("workflow.run.get", {
      id: started.runId,
    });
    expect(run.id).toBe(started.runId);
    expect(run.workflow).toBe("briefing");

    await skipped;
  });

  test("deletes a run and optionally its artifacts", async () => {
    const started = await call<{ runId: string }>("workflow.run", { id: "briefing", input: {} });
    const artifact = kernel.artifacts.create({
      kind: "note",
      contentType: "text/plain",
      content: "scratch",
      workflow: "briefing",
      correlationId: started.runId,
    });

    const deleted = await call<{ ok: boolean; runId: string; artifacts: number }>(
      "workflow.run.delete",
      { id: started.runId, artifacts: true },
    );
    expect(deleted.ok).toBe(true);
    expect(deleted.runId).toBe(started.runId);
    expect(deleted.artifacts).toBe(1);

    await expect(call("workflow.run.get", { id: started.runId })).rejects.toThrow();
    await expect(call("artifact.get", { id: artifact.id })).rejects.toThrow();
  });

  test("keeps artifacts when a run is deleted without them", async () => {
    const started = await call<{ runId: string }>("workflow.run", { id: "briefing", input: {} });
    const artifact = kernel.artifacts.create({
      kind: "note",
      contentType: "text/plain",
      content: "kept",
      workflow: "briefing",
      correlationId: started.runId,
    });

    const deleted = await call<{ artifacts: number }>("workflow.run.delete", {
      id: started.runId,
      artifacts: false,
    });
    expect(deleted.artifacts).toBe(0);
    await call("artifact.get", { id: artifact.id });
    await call("artifact.delete", { id: artifact.id });
  });

  test("cancels a running workflow and deletes it with its artifacts", async () => {
    let workflowReady = false;
    kernel.workflows.register(
      stubWorkflow({
        id: "slow-test",
        description: "test workflow",
        run: async (_input, context) => {
          workflowReady = true;
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
      }),
    );

    const started = await call<{ runId: string }>("workflow.run", { id: "slow-test", input: {} });
    await waitUntil(() => workflowReady);

    const artifact = kernel.artifacts.create({
      kind: "note",
      contentType: "text/plain",
      content: "partial output",
      workflow: "slow-test",
      correlationId: started.runId,
    });

    const cancelled = await call<{ ok: boolean; runId: string; cancelling: boolean }>(
      "workflow.run.cancel",
      { id: started.runId },
    );
    expect(cancelled.ok).toBe(true);
    expect(cancelled.cancelling).toBe(true);

    await waitUntil(() => !kernel.runs.list().some((run) => run.id === started.runId));
    await expect(call("artifact.get", { id: artifact.id })).rejects.toThrow();
  });

  test("searches and deletes artifacts through the gateway", async () => {
    const artifact = kernel.artifacts.create({
      kind: "note",
      name: "search note",
      contentType: "text/plain",
      content: "unique-search-token",
    });

    const results = await call<Array<{ id: string }>>("artifact.search", {
      query: "unique-search-token",
    });
    expect(results.some((entry) => entry.id === artifact.id)).toBe(true);

    const removed = await call<{ ok: boolean; artifactId: string }>("artifact.delete", {
      id: artifact.id,
    });
    expect(removed.artifactId).toBe(artifact.id);
    await expect(call("artifact.get", { id: artifact.id })).rejects.toThrow();
  });

  test("streams status updates over WebSocket", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${kernel.api.port}/api/ws`);
    const messages: Array<{ type: string; entry?: { text?: string } }> = [];
    ws.onmessage = (event) => messages.push(JSON.parse(String(event.data)));

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("websocket connection failed"));
    });

    await waitUntil(() => messages.some((message) => message.type === "snapshot"));

    kernel.statuses.begin("api-test-activity", "hello from test");
    await waitUntil(() =>
      messages.some(
        (message) => message.type === "entry" && message.entry?.text === "hello from test",
      ),
    );

    ws.close();
  });

  test("a failing workflow does not raise unhandled rejections", async () => {
    kernel.workflows.register(
      stubWorkflow({
        id: "boom",
        description: "always fails",
        run: async () => {
          throw new Error("boom");
        },
      }),
    );

    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", onRejection);

    try {
      // Subscribe before sending: the workflow may fail in the same tick.
      const failed = waitForEvent(
        kernel.bus,
        "workflow.failed",
        (event) => (event.payload as { workflow: string }).workflow === "boom",
      );

      const started = await call<{ started: boolean }>("workflow.run", { id: "boom", input: {} });
      expect(started.started).toBe(true);

      await failed;
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });

  test("re-sends a stored brief through the requested delivery channels", async () => {
    const brief = kernel.briefs.create({
      correlationId: "c-brief",
      topics: ["Rust"],
      markdown: "# Rust\n\nAll quiet.",
      narration: "Rust is quiet",
      sources: [
        { title: "Example", url: "https://example.com/article", provider: "perplexity" },
        { title: "Example dup", url: "https://example.com/other", provider: "perplexity" },
        { title: "News", url: "https://news.example.org/story", provider: "bluesky" },
      ],
    });
    kernel.briefs.attachAudio(brief.id, new Uint8Array([1, 2, 3]), "audio/ogg", 1000);
    const channel = kernel.deliveries.createChannel({ type: "matrix", name: "Matrix", config: {} });

    const result = await call<{
      briefId: string;
      results: Array<{ channelId: string; status: string; eventId?: string }>;
    }>("brief.send", { id: brief.id, channels: [channel.id] });

    expect(result.briefId).toBe(brief.id);
    // The injected stub delivery service answers with its canned result.
    expect(result.results).toEqual([{ channelId: "chan-1", status: "sent", eventId: "event-1" }]);

    const input = delivery.delivered.at(-1)!;
    expect(input.briefId).toBe(brief.id);
    expect(input.channels).toEqual([channel.id]);
    expect(input.summary).toContain("# Rust");
    expect(input.summary).toContain("**Sources**");
    expect(input.summary).toContain("[Example](https://example.com/article)");
    expect(input.summary).toContain("[News](https://news.example.org/story)");
    expect(input.summary).not.toContain("example.com/other");
    expect(input.html).toContain("<h2>Rust</h2>");
    expect(input.html).toContain('href="https://example.com/article"');
    expect(input.audio).toEqual(new Uint8Array([1, 2, 3]));
    expect(input.audioMime).toBe("audio/ogg");
  });

  test("manages delivery channels through the gateway", async () => {
    const created = await call<{
      id: string;
      type: string;
      name: string;
      config: Record<string, unknown>;
      enabled: boolean;
    }>("delivery.channel.create", {
      type: "discord",
      name: "War room",
      config: { webhookUrl: "https://discord.test/hook" },
    });
    expect(created.type).toBe("discord");
    expect(created.name).toBe("War room");
    expect(created.config).toEqual({ webhookUrl: "https://discord.test/hook" });

    const updated = await call<{ name: string; enabled: boolean }>("delivery.channel.update", {
      id: created.id,
      name: "War room v2",
      enabled: false,
    });
    expect(updated.name).toBe("War room v2");
    expect(updated.enabled).toBe(false);

    await call("delivery.attach", {
      workflow: "briefing",
      step: "brief",
      output: "brief",
      channelId: created.id,
    });
    const workflows = await call<Array<{ workflow: string; channelIds: string[] }>>(
      "delivery.workflows",
    );
    expect(workflows.find((entry) => entry.workflow === "briefing")?.channelIds).toContain(
      created.id,
    );
    const attachments = await call<
      Array<{ workflow: string; step: string; output: string; channelId: string }>
    >("delivery.attachments");
    expect(attachments).toContainEqual({
      workflow: "briefing",
      step: "brief",
      output: "brief",
      channelId: created.id,
    });

    const rows = await call<Array<{ channelId: string }>>("delivery.list", {});
    expect(rows).toEqual([]);

    await call("delivery.detach", {
      workflow: "briefing",
      step: "brief",
      output: "brief",
      channelId: created.id,
    });
    const afterDetach =
      (await call<Array<{ workflow: string; channelIds: string[] }>>("delivery.workflows")).find(
        (entry) => entry.workflow === "briefing",
      )?.channelIds ?? [];
    expect(afterDetach).not.toContain(created.id);

    const missingChannel = await post({
      type: "delivery.attach",
      payload: { workflow: "briefing", step: "brief", output: "brief", channelId: "missing" },
    });
    expect(missingChannel.status).toBe(404);

    // Outputs without a renderer cannot be assigned channels.
    const notDeliverable = await post({
      type: "delivery.attach",
      payload: {
        workflow: "briefing",
        step: "research",
        output: "research",
        channelId: created.id,
      },
    });
    expect(notDeliverable.status).toBe(400);

    const deleted = await call<{ ok: boolean }>("delivery.channel.delete", { id: created.id });
    expect(deleted.ok).toBe(true);
    expect((await call<Array<{ id: string }>>("delivery.channel.list")).map((c) => c.id)).not.toContain(created.id);
  });

  test("deletes a stored brief", async () => {
    const brief = kernel.briefs.create({
      topics: ["Obsolete"],
      markdown: "# Obsolete",
      narration: "n",
      sources: [],
    });

    const deletedEvent = waitForEvent(
      kernel.bus,
      "brief.deleted",
      (event) => (event.payload as { briefId: string }).briefId === brief.id,
    );

    const result = await call<{ ok: boolean; briefId: string }>("brief.delete", { id: brief.id });
    expect(result).toEqual({ ok: true, briefId: brief.id });
    await deletedEvent;

    const listed = await call<Array<{ id: string }>>("brief.list");
    expect(listed.some((entry) => entry.id === brief.id)).toBe(false);

    const missing = await post({ type: "brief.delete", payload: { id: brief.id } });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toContain("not found");
  });

  test("exposes briefs and their audio as referenced generic artifacts", async () => {
    const brief = kernel.briefs.create({
      correlationId: "c-artifact",
      workflow: "briefing",
      topics: ["Rust"],
      markdown: "# Rust\n\nAll quiet.",
      narration: "Rust is quiet",
      sources: [],
    });
    const audioArtifactId = kernel.briefs.attachAudio(
      brief.id,
      new Uint8Array([7, 7]),
      "audio/ogg",
      1500,
    );

    const list = await call<
      Array<{ id: string; kind: string; workflow?: string; correlationId?: string }>
    >("artifact.list", { kind: "brief" });
    const listed = list.find((entry) => entry.id === brief.id);
    expect(listed?.kind).toBe("brief");
    expect(listed?.workflow).toBe("briefing");
    expect(listed?.correlationId).toBe("c-artifact");

    const content = await call<{ content: string | null }>("artifact.content", { id: brief.id });
    expect(content.content).toContain("All quiet");

    const audio = await call<{ parentId?: string }>("artifact.get", { id: audioArtifactId });
    expect(audio.parentId).toBe(brief.id);

    const data = await call<{ contentType: string; dataUrl: string } | null>("artifact.data", {
      id: audioArtifactId,
    });
    expect(data?.contentType).toBe("audio/ogg");
    expect(data?.dataUrl.startsWith("data:audio/ogg;base64,")).toBe(true);

    const deleted = await call<{ ok: boolean; artifactId: string; kind: string }>(
      "artifact.delete",
      { id: brief.id },
    );
    expect(deleted).toEqual({ ok: true, artifactId: brief.id, kind: "brief" });

    // The audio child artifact is removed with its parent.
    const gone = await post({ type: "artifact.get", payload: { id: audioArtifactId } });
    expect(gone.status).toBe(404);
  });

  test("generates voice on demand and delivers it through the channels", async () => {
    const brief = kernel.briefs.create({
      topics: ["Rust"],
      markdown: "# Rust\n\nAll quiet.",
      narration: "Rust is quiet",
      sources: [],
    });
    const tts = kernel.tts as StubTts;
    const deliveredBefore = delivery.delivered.length;

    const result = await call<{
      briefId: string;
      generated: boolean;
      bytes: number;
      durationMs: number | null;
      eventId: string | null;
      results: Array<{ channelId: string; status: string; eventId?: string }>;
    }>("brief.audio.generate", { id: brief.id });

    expect(result.generated).toBe(true);
    expect(result.bytes).toBe(4);
    expect(result.eventId).toBeTruthy();
    expect(result.results).toEqual([{ channelId: "chan-1", status: "sent", eventId: "event-1" }]);
    expect(tts.requests).toHaveLength(1);
    expect(kernel.briefs.get(brief.id).hasAudio).toBe(true);

    const input = delivery.delivered.at(-1)!;
    expect(input.kinds).toEqual(["voice"]);
    expect(input.audio).toEqual(new Uint8Array([1, 2, 3, 4]));

    // A second call reuses the stored audio (no regeneration) but delivers again.
    const second = await call<{ generated: boolean }>("brief.audio.generate", { id: brief.id });
    expect(second.generated).toBe(false);
    expect(tts.requests).toHaveLength(1);
    expect(delivery.delivered).toHaveLength(deliveredBefore + 2);

    // regenerate without delivery only produces audio.
    const third = await call<{ generated: boolean; eventId: string | null; results: unknown[] }>(
      "brief.audio.generate",
      { id: brief.id, regenerate: true, deliver: false },
    );
    expect(third.generated).toBe(true);
    expect(third.eventId).toBeNull();
    expect(third.results).toEqual([]);
    expect(tts.requests).toHaveLength(2);
    expect(delivery.delivered).toHaveLength(deliveredBefore + 2);
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
