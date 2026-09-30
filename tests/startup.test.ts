import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { StartupValidator } from "../src/core/startup/StartupValidator.ts";
import { StartupService, formatStartupReport } from "../src/startup/StartupService.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import type { MessagingProvider, OutboundMessage, SentMessage } from "../src/capabilities/messaging/MessagingProvider.ts";
import type { LlmProvider } from "../src/capabilities/llm/LlmProvider.ts";
import type { TextToSpeechProvider } from "../src/capabilities/tts/TtsProvider.ts";
import { StubMessaging, StubTts, completion, stubLlm, stubSearch, testConfig, waitForEvent } from "./support.ts";
import { createKernel } from "../src/kernel/Kernel.ts";

const log = createLogger("test", { level: "error" });

function setupBus(): EventBus {
  const db = new SqliteDatabase(":memory:");
  return new EventBus(new EventStore(db), log);
}

const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

describe("StartupValidator", () => {
  test("runs checks, collects outcomes and emits events", async () => {
    const bus = setupBus();
    const events: DomainEvent[] = [];
    bus.subscribe("system.*", (event) => events.push(event));

    const validator = new StartupValidator({
      bus,
      logger: log,
      defaultTimeoutMs: 1000,
      checks: [
        { name: "good", run: async () => ({ status: "ok", detail: "fine" }) },
        { name: "bad", run: async () => { throw new Error("boom"); } },
        { name: "skip", run: async () => ({ status: "skipped", detail: "not set" }) },
      ],
    });

    const report = await validator.run();

    expect(report.ok).toBe(false);
    expect(report.results.map((result) => result.name)).toEqual(["good", "bad", "skip"]);
    expect(report.results[1]?.detail).toBe("boom");

    const checkEvents = events.filter((event) => event.topic === "system.check.completed");
    expect(checkEvents).toHaveLength(3);

    const summary = events.find((event) => event.topic === "system.validation.completed");
    expect(summary?.payload).toMatchObject({ ok: false, failed: ["bad"], skipped: ["skip"] });
  });

  test("times out hanging checks", async () => {
    const bus = setupBus();
    const validator = new StartupValidator({
      bus,
      logger: log,
      checks: [{ name: "hang", timeoutMs: 50, run: () => new Promise<never>(() => {}) }],
    });

    const report = await validator.run();
    expect(report.ok).toBe(false);
    expect(report.results[0]?.detail).toContain("timed out");
  });
});

describe("formatStartupReport", () => {
  test("includes per-check statuses and the failure summary", () => {
    const text = formatStartupReport(
      {
        startedAt: Date.parse("2026-09-29T07:00:00Z"),
        durationMs: 100,
        ok: false,
        results: [
          { name: "llm", status: "ok", detail: "reachable, 3 models", durationMs: 10 },
          { name: "matrix", status: "failed", detail: "M_FORBIDDEN", durationMs: 20 },
        ],
      },
      { jobs: 1, workflows: ["briefing"], timezone: "Europe/Berlin" },
    );

    expect(text).toContain("Briefing Engine started – 2026-09-29 07:00 UTC");
    expect(text).toContain("[ok] llm: reachable, 3 models");
    expect(text).toContain("[failed] matrix: M_FORBIDDEN");
    expect(text).toContain("Startup validation: 1 check(s) failed (matrix)");
    expect(text).toContain("Workflows: briefing");
  });
});

/** All integrations configured (the Matrix delivery channel is passed as a dep). */
function configuredConfig(overrides: Record<string, string | undefined> = {}) {
  return testConfig({
    OPENCODE_API_KEY: "key",
    KEY_PERPLEXITY: "key",
    QWEN_TTS_BASE_URL: "http://tts.test/v1",
    BLUESKY_IDENTIFIER: "bot.test",
    BLUESKY_APP_PASSWORD: "pw",
    ...overrides,
  });
}

function okMockFetch(): void {
  mockFetch(async (input) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) return Response.json({ data: [{}, {}] });
    if (url.endsWith("/search")) return Response.json({ results: [{}] });
    return new Response("not found", { status: 404 });
  });
}

function buildService(overrides: {
  config?: ReturnType<typeof testConfig>;
  messaging?: MessagingProvider;
  bus?: EventBus;
  llm?: LlmProvider;
  tts?: TextToSpeechProvider;
  /** First enabled matrix delivery channel summary; absent = no Matrix. */
  matrix?: { roomId?: string } | null;
}) {
  const bus = overrides.bus ?? setupBus();
  const messaging = overrides.messaging ?? new StubMessaging();
  const service = new StartupService({
    config: overrides.config ?? configuredConfig({ STARTUP_CHECK: "true", STARTUP_ANNOUNCE: "true" }),
    bus,
    logger: log,
    llm: overrides.llm ?? stubLlm(() => completion("ok")),
    webSearch: stubSearch("perplexity", "web", [{ title: "t", url: "https://example.com", snippet: "s", source: "example.com" }]),
    socialSearch: stubSearch("bluesky", "social", [{ title: "t", url: "https://bsky.app/x", snippet: "s", source: "bsky.app" }]),
    tts: overrides.tts ?? new StubTts(),
    messaging,
    matrix: overrides.matrix ?? null,
    jobs: 1,
    workflows: ["briefing"],
  });
  return { service, bus, messaging };
}

/** Providers whose live verification fails (used to exercise failed checks). */
function failingLlm(): LlmProvider & { verify(): Promise<string> } {
  return {
    name: "failing-llm",
    defaultModel: "stub",
    complete: async () => completion("unused"),
    verify: async () => {
      throw new Error("unauthorized");
    },
  };
}

function failingTts(): TextToSpeechProvider & { verify(): Promise<string> } {
  return {
    name: "failing-tts",
    defaultVoiceId: "stub",
    synthesize: async () => {
      throw new Error("unused");
    },
    verify: async () => {
      throw new Error("connection refused");
    },
  };
}

describe("StartupService", () => {
  test("validates all integrations and announces the report to Matrix", async () => {
    okMockFetch();
    const { service, bus, messaging } = buildService({
      matrix: { roomId: "!room:matrix.test" },
    });

    const events: DomainEvent[] = [];
    bus.subscribe("system.*", (event) => events.push(event));

    const result = await service.run();

    expect(result.report.ok).toBe(true);
    expect(result.report.results.map((entry) => `${entry.name}:${entry.status}`)).toEqual([
      "llm:ok",
      "perplexity:ok",
      "bluesky:ok",
      "tts:ok",
      "web-search:ok",
      "matrix:ok",
    ]);

    expect(result.announce.status).toBe("sent");
    expect((messaging as StubMessaging).sent).toHaveLength(1);

    const message = (messaging as StubMessaging).sent[0]!.message;
    expect(message.kind).toBe("text");
    if (message.kind === "text") {
      expect(message.text).toContain("[ok] llm");
      expect(message.text).toContain("[ok] tts");
      expect(message.text).toContain("Startup validation: all checks passed.");
    }

    expect(events.some((event) => event.topic === "system.startup.announced")).toBe(true);
  });

  test("reports failures in the announcement", async () => {
    const { service, messaging } = buildService({
      llm: failingLlm(),
      tts: failingTts(),
      matrix: { roomId: "!room:matrix.test" },
    });

    const result = await service.run();

    expect(result.report.ok).toBe(false);
    expect(result.announce.status).toBe("sent");

    const message = (messaging as StubMessaging).sent[0]!.message;
    if (message.kind === "text") {
      expect(message.text).toContain("[failed] llm");
      expect(message.text).toContain("[failed] tts");
      expect(message.text).toContain("2 check(s) failed (llm, tts)");
    }
  });

  test("marks unconfigured integrations as skipped without failing", async () => {
    mockFetch(async () => new Response("should not be called", { status: 500 }));
    const { service, messaging } = buildService({
      config: testConfig({ STARTUP_CHECK: "true" }),
    });

    const result = await service.run();

    expect(result.report.ok).toBe(true);
    expect(result.report.results.every((entry) => entry.status === "skipped")).toBe(true);
    expect(result.announce.status).toBe("skipped");
    expect((messaging as StubMessaging).sent).toHaveLength(0);
  });

  test("does not announce by default even when Matrix is configured", async () => {
    okMockFetch();
    const { service, messaging } = buildService({
      config: testConfig({ STARTUP_CHECK: "true" }),
      matrix: { roomId: "!room:matrix.test" },
    });

    const result = await service.run();

    expect(result.report.ok).toBe(true);
    expect(result.announce.status).toBe("skipped");
    expect(result.announce.detail).toContain("STARTUP_ANNOUNCE");
    expect((messaging as StubMessaging).sent).toHaveLength(0);
  });

  test("captures announcement failures without crashing", async () => {
    okMockFetch();
    const failingMessaging: MessagingProvider = {
      name: "failing",
      defaultChannel: undefined,
      send: async (_message: OutboundMessage): Promise<SentMessage> => {
        throw new Error("M_FORBIDDEN: no permission to post");
      },
    };

    const { service, bus } = buildService({
      messaging: failingMessaging,
      matrix: { roomId: "!room:matrix.test" },
    });
    const events: DomainEvent[] = [];
    bus.subscribe("system.*", (event) => events.push(event));

    const result = await service.run();

    expect(result.report.ok).toBe(true);
    expect(result.announce.status).toBe("failed");
    expect(result.announce.detail).toContain("M_FORBIDDEN");
    expect(events.some((event) => event.topic === "system.startup.announce_failed")).toBe(true);
  });
});

describe("kernel startup validation", () => {
  test("runs on boot and announces to the messaging provider", async () => {
    okMockFetch();
    const messaging = new StubMessaging();

    const kernel = await createKernel({
      config: configuredConfig({ STARTUP_CHECK: "true", STARTUP_ANNOUNCE: "true" }),
      // Legacy Matrix env config → migrated into a delivery channel on boot.
      env: {
        MATRIX_HOMESERVER_URL: "https://matrix.test",
        MATRIX_ACCESS_TOKEN: "token",
        MATRIX_ROOM_ID: "!room:matrix.test",
      },
      logger: log,
      webSearch: stubSearch("perplexity", "web"),
      socialSearch: stubSearch("bluesky", "social"),
      messaging,
    });

    try {
      await waitForEvent(kernel.bus, "system.startup.announced", undefined, 5000);
      expect((messaging as StubMessaging).sent).toHaveLength(1);
      expect((messaging as StubMessaging).sent[0]?.message.kind).toBe("text");
    } finally {
      await kernel.shutdown();
    }
  });
});

