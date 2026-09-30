import { afterEach, describe, expect, test } from "bun:test";
import { DeliveryRepository } from "../src/domain/delivery/DeliveryRepository.ts";
import { DeliveryService } from "../src/delivery/DeliveryService.ts";
import { createDeliverySender } from "../src/providers/delivery/DeliverySenders.ts";
import { DiscordDeliveryChannel } from "../src/providers/delivery/DiscordDeliveryChannel.ts";
import { MatrixDeliveryChannel } from "../src/providers/delivery/MatrixDeliveryChannel.ts";
import { createKernel } from "../src/kernel/Kernel.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import { StubChannelSender, testConfig } from "./support.ts";

const log = createLogger("test", { level: "error" });

function setupBus(): EventBus {
  return new EventBus(new EventStore(new SqliteDatabase(":memory:")), log);
}

// Replace global fetch per test and always restore it, so later test files
// still have a working fetch.
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  globalThis.fetch = implementation as unknown as typeof fetch;
}

describe("DeliveryRepository", () => {
  test("round-trips channel CRUD", () => {
    const repo = new DeliveryRepository(new SqliteDatabase(":memory:"));

    expect(repo.countChannels()).toBe(0);
    const matrix = repo.createChannel({
      type: "matrix",
      name: "Matrix",
      config: { homeserverUrl: "https://matrix.test", roomId: "!room:x" },
    });
    const discord = repo.createChannel({ type: "discord", name: "War room", enabled: false });

    expect(repo.countChannels()).toBe(2);
    expect(matrix.enabled).toBe(true);
    expect(matrix.config).toEqual({ homeserverUrl: "https://matrix.test", roomId: "!room:x" });
    expect(repo.channels().map((channel) => channel.type)).toEqual(["matrix", "discord"]);
    expect(repo.channel(discord.id).enabled).toBe(false);

    const updated = repo.updateChannel(discord.id, { name: "War room v2", enabled: true });
    expect(updated.name).toBe("War room v2");
    expect(updated.enabled).toBe(true);
    expect(updated.createdAt).toBe(discord.createdAt);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(discord.updatedAt);

    expect(() => repo.channel("missing")).toThrow(/not found/);
    expect(() => repo.createChannel({ type: "slack" as never, name: "x" })).toThrow(/type/);

    repo.removeChannel(matrix.id);
    expect(repo.countChannels()).toBe(1);
  });

  test("round-trips step-output attachments and cascades channel deletes", () => {
    const repo = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const first = repo.createChannel({ type: "matrix", name: "Matrix" });
    const second = repo.createChannel({ type: "email", name: "Mail" });
    const briefText = { workflow: "briefing", step: "brief", output: "brief" };
    const voice = { workflow: "briefing", step: "audio", output: "audio" };
    const answer = { workflow: "qa", step: "answer", output: "answer" };

    repo.attach(briefText, first.id);
    repo.attach(voice, second.id);
    repo.attach(answer, second.id);
    repo.attach(briefText, first.id); // idempotent

    expect(repo.attachments()).toEqual([
      { ...briefText, channelId: first.id },
      { ...voice, channelId: second.id },
      { ...answer, channelId: second.id },
    ]);
    expect(repo.workflows()).toEqual([
      { workflow: "briefing", channelIds: [first.id, second.id] },
      { workflow: "qa", channelIds: [second.id] },
    ]);

    repo.detach(briefText, first.id);
    expect(repo.workflows()[0]?.channelIds).toEqual([second.id]);

    // Removing a channel cascades to every attachment referencing it.
    repo.removeChannel(second.id);
    expect(repo.attachments()).toEqual([]);
    expect(repo.workflows()).toEqual([]);
  });

  test("detaches every attachment of one workflow", () => {
    const repo = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const first = repo.createChannel({ type: "matrix", name: "Matrix" });
    const second = repo.createChannel({ type: "email", name: "Mail" });

    repo.attach({ workflow: "briefing", step: "brief", output: "brief" }, first.id);
    repo.attach({ workflow: "user-1", step: "brief", output: "brief" }, first.id);
    repo.attach({ workflow: "user-1", step: "audio", output: "audio" }, second.id);

    repo.detachWorkflow("user-1");
    expect(repo.attachments()).toEqual([
      { workflow: "briefing", step: "brief", output: "brief", channelId: first.id },
    ]);
  });

  test("round-trips deliveries: pending rows, completion and filters", () => {
    const repo = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const channel = repo.createChannel({ type: "matrix", name: "Matrix" });

    const row = repo.record({
      briefId: "brief-1",
      runId: "run-1",
      channelId: channel.id,
      kind: "text",
    });
    expect(row.status).toBe("pending");
    expect(row.runId).toBe("run-1");

    const voice = repo.record({ briefId: "brief-1", channelId: channel.id, kind: "voice" });
    expect(voice.runId).toBeUndefined();

    repo.complete(row.id, { status: "sent", eventId: "$evt-1" });
    repo.complete(voice.id, { status: "failed", error: "SMTP refused" });

    const rows = repo.deliveries();
    expect(rows.map((entry) => `${entry.kind}:${entry.status}`)).toEqual([
      "text:sent",
      "voice:failed",
    ]);
    expect(rows[0]?.eventId).toBe("$evt-1");
    expect(rows[1]?.error).toBe("SMTP refused");

    expect(repo.deliveries({ briefId: "brief-1" })).toHaveLength(2);
    expect(repo.deliveries({ runId: "run-1" }).map((entry) => entry.kind)).toEqual(["text"]);
    expect(repo.deliveries({ briefId: "other" })).toEqual([]);
    expect(() => repo.complete("missing", { status: "sent" })).toThrow(/not found/);
  });
});

describe("createDeliverySender", () => {
  test("rejects unusable channel configurations", () => {
    expect(() => createDeliverySender("matrix", {})).toThrow(/homeserverUrl/);
    expect(() => createDeliverySender("discord", {})).toThrow(/webhookUrl/);
    expect(() => createDeliverySender("email", { host: "smtp.test" })).toThrow(/from and a to/);
    expect(() => createDeliverySender("pigeon" as never, {})).toThrow();
  });

  test("matrix needs a room id or a DM user", () => {
    expect(() =>
      createDeliverySender("matrix", { homeserverUrl: "https://matrix.test", accessToken: "tok" }),
    ).toThrow(/roomId or a DM user/);
    expect(
      () =>
        new MatrixDeliveryChannel({
          homeserverUrl: "https://matrix.test",
          accessToken: "tok",
          dmUserId: "alice",
        }),
    ).toThrow(/@user:server/);
  });

  test("discord webhook: verify, text POST and voice fallback", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let posts = 0;
    mockFetch(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (method === "GET") return Response.json({ id: "wh-1" });
      posts += 1;
      return Response.json({ id: `msg-${posts}` });
    });

    const sender = new DiscordDeliveryChannel({ webhookUrl: "https://discord.test/webhook" });

    expect(await sender.verify()).toContain("wh-1");

    const sent = await sender.sendText({ text: "hello", html: "<b>hello</b>" });
    expect(sent.eventId).toBe("msg-1");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.url).toContain("wait=true");
    expect(JSON.parse(calls[1]!.body!)).toEqual({ content: "hello" });

    const voice = await sender.sendVoice({
      audio: new Uint8Array([1]),
      mimeType: "audio/ogg",
      filename: "brief.ogg",
      caption: "Morning brief",
      text: "summary text",
    });
    expect(voice.eventId).toBe("msg-2");
    expect(JSON.parse(calls[2]!.body!)).toMatchObject({
      content: expect.stringContaining("summary text"),
    });
    expect(JSON.parse(calls[2]!.body!)).toMatchObject({
      content: expect.stringContaining("voice message was delivered to the Matrix channels"),
    });
  });

  test("discord truncates content to the 2000 character limit", async () => {
    let body = "";
    mockFetch(async (_input, init) => {
      body = String(init?.body);
      return Response.json({ id: "$msg" });
    });

    const sender = new DiscordDeliveryChannel({ webhookUrl: "https://discord.test/webhook" });
    await sender.sendText({ text: "x".repeat(5000) });

    const content = (JSON.parse(body) as { content: string }).content;
    expect(content.length).toBe(2000);
    expect(content.endsWith("…")).toBe(true);
  });

  test("matrix channel sends text with formatted body and voice via upload", async () => {
    const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      const call = {
        url,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : undefined,
        auth: new Headers(init?.headers).get("authorization") ?? undefined,
      };
      calls.push(call);
      if (url.includes("/media/upload")) return Response.json({ content_uri: "mxc://x/abc" });
      if (url.includes("/send/m.room.message/")) return Response.json({ event_id: "$evt1" });
      return new Response("not found", { status: 404 });
    });

    const sender = new MatrixDeliveryChannel({
      homeserverUrl: "https://matrix.test",
      accessToken: "tok",
      roomId: "!room:matrix.test",
    });

    const text = await sender.sendText({ text: "hello", html: "<b>hello</b>" });
    expect(text.eventId).toBe("$evt1");

    const textCall = calls[0]!;
    expect(textCall.method).toBe("PUT");
    expect(textCall.auth).toBe("Bearer tok");
    const textContent = JSON.parse(textCall.body!) as Record<string, unknown>;
    expect(textContent.msgtype).toBe("m.text");
    expect(textContent.formatted_body).toBe("<b>hello</b>");
    expect(textContent.format).toBe("org.matrix.custom.html");

    const voice = await sender.sendVoice({
      audio: new Uint8Array([1, 2]),
      mimeType: "audio/ogg",
      filename: "brief.ogg",
      caption: "Morning brief",
      text: "narration",
    });
    expect(voice.eventId).toBe("$evt1");
    expect(calls.some((call) => call.url.includes("/media/upload"))).toBe(true);

    const voiceContent = JSON.parse(calls.at(-1)!.body!) as Record<string, unknown>;
    expect(voiceContent.msgtype).toBe("m.audio");
    expect(voiceContent["org.matrix.msc3245.voice"]).toEqual({});
  });

  test("matrix verify checks identity and room membership", async () => {
    mockFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/account/whoami")) return Response.json({ user_id: "@bot:matrix.test" });
      if (url.includes("/state/m.room.member/")) return Response.json({ membership: "join" });
      return new Response("not found", { status: 404 });
    });

    const sender = new MatrixDeliveryChannel({
      homeserverUrl: "https://matrix.test",
      accessToken: "tok",
      roomId: "!room:matrix.test",
    });

    expect(await sender.verify()).toContain("@bot:matrix.test joined !room:matrix.test");
  });

  test("matrix DM opens the direct room once, records it and reuses it", async () => {
    const calls: Array<{ url: string; method: string; body?: string }> = [];
    let rooms = 0;
    mockFetch(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({ url, method, body: typeof init?.body === "string" ? init.body : undefined });
      if (url.endsWith("/account/whoami")) return Response.json({ user_id: "@bot:matrix.test" });
      if (url.includes("/account_data/m.direct")) {
        return method === "GET"
          ? new Response("not found", { status: 404 })
          : Response.json({});
      }
      if (url.includes("/media/upload")) return Response.json({ content_uri: "mxc://x/abc" });
      if (url.endsWith("/createRoom")) {
        rooms += 1;
        return Response.json({ room_id: "!dm:matrix.test" });
      }
      if (url.includes("/send/m.room.message/")) return Response.json({ event_id: "$dm-evt" });
      return new Response("not found", { status: 404 });
    });

    const sender = new MatrixDeliveryChannel({
      homeserverUrl: "https://matrix.test",
      accessToken: "tok",
      dmUserId: "alice:matrix.test",
    });

    expect((await sender.sendText({ text: "hello" })).eventId).toBe("$dm-evt");
    await sender.sendVoice({
      audio: new Uint8Array([1]),
      mimeType: "audio/ogg",
      filename: "brief.ogg",
      caption: "Morning brief",
      text: "narration",
    });

    expect(rooms).toBe(1);
    const create = calls.find((call) => call.url.endsWith("/createRoom"))!;
    expect(JSON.parse(create.body!)).toEqual({
      preset: "trusted_private_chat",
      is_direct: true,
      invite: ["@alice:matrix.test"],
    });
    const recorded = calls.find(
      (call) => call.url.includes("/account_data/m.direct") && call.method === "PUT",
    )!;
    expect(JSON.parse(recorded.body!)).toEqual({ "@alice:matrix.test": ["!dm:matrix.test"] });

    const sent = calls.filter((call) => call.url.includes("/send/m.room.message/"));
    expect(sent).toHaveLength(2);
    expect(sent.every((call) => call.url.includes(encodeURIComponent("!dm:matrix.test")))).toBe(
      true,
    );
  });

  test("matrix DM reuses a joined room from m.direct", async () => {
    const calls: string[] = [];
    mockFetch(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/account/whoami")) return Response.json({ user_id: "@bot:matrix.test" });
      if (url.includes("/account_data/m.direct")) {
        return Response.json({ "@alice:matrix.test": ["!old:matrix.test"] });
      }
      if (url.includes("/state/m.room.member/")) return Response.json({ membership: "join" });
      if (url.endsWith("/createRoom")) return Response.json({ room_id: "!new:matrix.test" });
      return new Response("not found", { status: 404 });
    });

    const sender = new MatrixDeliveryChannel({
      homeserverUrl: "https://matrix.test",
      accessToken: "tok",
      dmUserId: "@alice:matrix.test",
    });

    expect(await sender.verify()).toBe(
      "@bot:matrix.test joined !old:matrix.test (DM with @alice:matrix.test)",
    );
    expect(calls.some((url) => url.endsWith("/createRoom"))).toBe(false);
  });
});

describe("DeliveryService", () => {
  interface Setup {
    service: DeliveryService;
    store: DeliveryRepository;
    bus: EventBus;
    sender: StubChannelSender;
  }

  function setupDelivery(): Setup {
    const store = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const bus = setupBus();
    const sender = new StubChannelSender();
    const service = new DeliveryService({
      store,
      bus,
      logger: log,
      createSender: () => sender,
    });
    return { service, store, bus, sender };
  }

  test("delivers text and voice to the channels attached to the step output", async () => {
    const { service, store, bus } = setupDelivery();
    const channel = store.createChannel({ type: "matrix", name: "Matrix", config: {} });
    const target = { workflow: "briefing", step: "brief", output: "brief" };
    store.attach(target, channel.id);

    expect(service.channelsFor(target)).toEqual([channel.id]);
    expect(service.channelsFor({ ...target, step: "audio", output: "audio" })).toEqual([]);

    const events: DomainEvent[] = [];
    bus.subscribe("delivery.*", (event) => events.push(event));

    const results = await service.deliver({
      briefId: "brief-1",
      runId: "run-1",
      target,
      summary: "Summary text",
      html: "<b>Summary text</b>",
      narration: "spoken text",
      audio: new Uint8Array([1, 2, 3]),
      audioMime: "audio/ogg",
    });

    expect(results).toEqual([{ channelId: channel.id, status: "sent", eventId: "evt-2" }]);

    const rows = store.deliveries({ briefId: "brief-1" });
    expect(rows.map((row) => `${row.kind}:${row.status}`)).toEqual(["text:sent", "voice:sent"]);
    expect(rows[0]?.eventId).toBe("evt-1");
    expect(rows[0]?.runId).toBe("run-1");

    const topics = events.map((event) => `${(event.payload as { kind: string }).kind}:${(event.payload as { status: string }).status}`);
    expect(topics).toEqual(["text:pending", "text:sent", "voice:pending", "voice:sent"]);

    const sentEvent = events[1]!;
    expect(sentEvent.payload).toMatchObject({
      briefId: "brief-1",
      runId: "run-1",
      channelId: channel.id,
      kind: "text",
      status: "sent",
      eventId: "evt-1",
    });
  });

  test("uses explicit channels when given and validates them", async () => {
    const { service, store } = setupDelivery();
    const enabled = store.createChannel({ type: "matrix", name: "Enabled" });
    const disabled = store.createChannel({ type: "discord", name: "Disabled", enabled: false });
    // Assigned to qa, not to the briefing workflow.
    store.attach({ workflow: "qa", step: "answer", output: "answer" }, enabled.id);

    const results = await service.deliver({
      briefId: "b",
      channels: [enabled.id],
      summary: "s",
    });
    expect(results.map((result) => result.channelId)).toEqual([enabled.id]);

    await expect(
      service.deliver({ briefId: "b", channels: ["missing"], summary: "s" }),
    ).rejects.toThrow(/not found/);
    await expect(
      service.deliver({ briefId: "b", channels: [disabled.id], summary: "s" }),
    ).rejects.toThrow(/disabled/);

    // No enabled channels attached to "briefing": nothing to do.
    expect(await service.deliver({ briefId: "b", summary: "s" })).toEqual([]);
  });

  test("one failing channel does not stop the others", async () => {
    const store = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const bus = setupBus();
    const good = new StubChannelSender();
    const bad = new StubChannelSender();
    bad.failText = "webhook exploded";
    bad.failVoice = "webhook exploded";
    const service = new DeliveryService({
      store,
      bus,
      logger: log,
      createSender: (channel) => (channel.type === "discord" ? bad : good),
    });

    const first = store.createChannel({ type: "matrix", name: "Matrix" });
    const second = store.createChannel({ type: "discord", name: "Hook" });
    const target = { workflow: "briefing", step: "brief", output: "brief" };
    store.attach(target, first.id);
    store.attach(target, second.id);

    const results = await service.deliver({
      briefId: "b1",
      summary: "s",
      audio: new Uint8Array([1]),
    });

    expect(results).toEqual([
      { channelId: first.id, status: "sent", eventId: "evt-2" },
      { channelId: second.id, status: "failed", error: "webhook exploded" },
    ]);
    expect(good.sent).toHaveLength(2);
    expect(bad.sent).toHaveLength(0);

    const rows = store.deliveries({ briefId: "b1" });
    expect(rows.filter((row) => row.channelId === second.id).map((row) => row.status)).toEqual([
      "failed",
      "failed",
    ]);
  });

  test("records a failed row when the channel config cannot build a sender", async () => {
    const store = new DeliveryRepository(new SqliteDatabase(":memory:"));
    const bus = setupBus();
    const service = new DeliveryService({
      store,
      bus,
      logger: log,
      createSender: () => {
        throw new Error("channel config needs a homeserverUrl");
      },
    });
    const channel = store.createChannel({ type: "matrix", name: "Broken" });
    store.attach({ workflow: "briefing", step: "brief", output: "brief" }, channel.id);

    const results = await service.deliver({ briefId: "b", summary: "s" });

    expect(results).toEqual([
      { channelId: channel.id, status: "failed", error: "channel config needs a homeserverUrl" },
    ]);
    expect(store.deliveries({ briefId: "b" }).map((row) => row.status)).toEqual(["failed"]);
  });

  test("honors the kinds filter (voice only)", async () => {
    const { service, store, sender } = setupDelivery();
    const channel = store.createChannel({ type: "matrix", name: "Matrix" });
    store.attach({ workflow: "briefing", step: "audio", output: "audio" }, channel.id);

    const results = await service.deliver({
      briefId: "b",
      kinds: ["voice"],
      summary: "s",
      audio: new Uint8Array([1]),
    });

    expect(results).toEqual([{ channelId: channel.id, status: "sent", eventId: "evt-1" }]);
    expect(sender.sent.map((entry) => entry.kind)).toEqual(["voice"]);
    expect(sender.sent[0]?.text).toBe("s");
    expect(sender.sent[0]?.caption).toContain("Morning brief");
  });

  test("uses the channels attached to the workflow being delivered", async () => {
    const { service, store, sender } = setupDelivery();
    const briefing = store.createChannel({ type: "matrix", name: "Briefing" });
    const user = store.createChannel({ type: "discord", name: "User" });
    store.attach({ workflow: "briefing", step: "brief", output: "brief" }, briefing.id);
    store.attach({ workflow: "user-1", step: "brief", output: "brief" }, user.id);

    const results = await service.deliver({ briefId: "b", workflow: "user-1", summary: "s" });

    expect(results.map((result) => result.channelId)).toEqual([user.id]);
    expect(sender.sent).toHaveLength(1);

    // A workflow without attachments receives nothing.
    expect(await service.deliver({ briefId: "b", workflow: "missing", summary: "s" })).toEqual([]);
  });
});

describe("boot migration", () => {
  test("creates a matrix channel from the legacy environment", async () => {
    mockFetch(async () => new Response("nope", { status: 404 }));

    const kernel = await createKernel({
      config: testConfig(),
      env: {
        MATRIX_HOMESERVER_URL: "https://matrix.test",
        MATRIX_ROOM_ID: "!room:matrix.test",
        MATRIX_ACCESS_TOKEN: "tok",
        MATRIX_ALLOWED_SENDERS: "@a:x.org, @b:x.org",
      },
    });

    try {
      const channels = kernel.deliveries.channels();
      expect(channels).toHaveLength(1);
      const migrated = channels[0]!;
      expect(migrated).toMatchObject({ type: "matrix", name: "Matrix", enabled: true });
      expect(migrated.config).toEqual({
        homeserverUrl: "https://matrix.test",
        roomId: "!room:matrix.test",
        accessToken: "tok",
        allowedSenders: "@a:x.org, @b:x.org",
      });

      // The Matrix settings group is gone from the settings UI.
      expect(kernel.settings.list().some((setting) => setting.key.startsWith("MATRIX_"))).toBe(
        false,
      );
    } finally {
      await kernel.shutdown();
    }
  });

  test("consumes legacy stored setting overrides when env is silent", async () => {
    mockFetch(async () => new Response("nope", { status: 404 }));

    class MapKv {
      private readonly map = new Map<string, string>();
      get(key: string): string | null {
        return this.map.get(key) ?? null;
      }
      set(key: string, value: string): void {
        this.map.set(key, value);
      }
      delete(key: string): void {
        this.map.delete(key);
      }
    }
    const kv = new MapKv();
    kv.set("setting:MATRIX_HOMESERVER_URL", "https://matrix.test");
    kv.set("setting:MATRIX_ROOM_ID", "!room:matrix.test");
    kv.set("setting:MATRIX_PASSWORD", "pw");
    kv.set("setting:MATRIX_USERNAME", "bot");

    const kernel = await createKernel({
      config: testConfig(),
      stores: { kv },
    });

    try {
      const channels = kernel.deliveries.channels();
      expect(channels).toHaveLength(1);
      const migrated = channels[0]!;
      expect(migrated.config).toMatchObject({
        homeserverUrl: "https://matrix.test",
        roomId: "!room:matrix.test",
        username: "bot",
        password: "pw",
      });
      // The consumed overrides are removed from the kv store.
      expect(kv.get("setting:MATRIX_ROOM_ID")).toBeNull();
    } finally {
      await kernel.shutdown();
    }
  });

  test("leaves no channel when nothing was configured", async () => {
    const kernel = await createKernel({ config: testConfig() });

    try {
      expect(kernel.deliveries.channels()).toEqual([]);
      expect(kernel.deliveries.workflows()).toEqual([]);
    } finally {
      await kernel.shutdown();
    }
  });
});
