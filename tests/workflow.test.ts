import { describe, expect, test } from "bun:test";
import { BriefingWorkflow } from "../src/workflows/BriefingWorkflow.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { TopicRepository } from "../src/domain/topics/TopicRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import { createLogger } from "../src/core/logger.ts";
import type { DomainEvent } from "../src/core/events/types.ts";
import {
  StubMessaging,
  StubTts,
  completion,
  sampleResults,
  stubLlm,
  stubSearch,
} from "./support.ts";

const log = createLogger("test", { level: "error" });

interface SetupOptions {
  webResults?: typeof sampleResults;
  socialResults?: typeof sampleResults;
  /** Verdict the research agent reports for its final JSON answer. */
  researchVerdict?: boolean;
}

function setup(options: SetupOptions = {}) {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const topics = new TopicRepository(db);
  const briefs = new BriefRepository(db);

  const llm = stubLlm((request) => {
    const system = request.messages[0]?.content ?? "";

    if (system.includes("editor")) {
      return completion(
        JSON.stringify({
          markdown: "# Morning brief\n\n## Rust\nAll quiet.\n\n## AI regulation\nHeated debate.",
          narration:
            "Rust is quiet today. AI regulation is being debated. Sources: 1. example.com https://example.com/article",
        }),
      );
    }

    const toolMessages = request.messages.filter((message) => message.role === "tool").length;
    if (toolMessages === 0) {
      return completion("", [{ id: "call-1", name: "perplexity_search", arguments: { query: "t" } }]);
    }
    if (toolMessages === 1) {
      return completion("", [{ id: "call-2", name: "bluesky_search", arguments: { query: "t" } }]);
    }
    return completion(
      JSON.stringify({
        found: options.researchVerdict ?? true,
        notes: "Notes: something happened https://example.com/article",
      }),
    );
  });

  const statuses = new StatusHub();
  const tts = new StubTts();
  const messaging = new StubMessaging();

  const workflow = new BriefingWorkflow({
    topics,
    briefs,
    llm,
    webSearch: stubSearch("perplexity", "web", options.webResults ?? sampleResults),
    socialSearch: stubSearch("bluesky", "social", options.socialResults ?? [sampleResults[1]!]),
    tts,
    messaging,
    statuses,
    defaults: { recency: "day", resultsPerProvider: 5, language: "en" },
  });

  return { workflow, topics, briefs, bus, tts, messaging, statuses };
}

describe("BriefingWorkflow", () => {
  test("skips cleanly when no topics are configured", async () => {
    const { workflow, bus, statuses } = setup();
    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run({}, { correlationId: "c1", bus, logger: log, statuses });

    expect(output.skipped).toBe(true);
    expect(events.some((event) => event.topic === "brief.skipped")).toBe(true);
  });

  test("researches topics, compiles a brief, synthesizes audio and delivers it", async () => {
    const { workflow, topics, briefs, bus, tts, messaging, statuses } = setup();
    topics.add({ name: "Rust" });
    topics.add({ name: "AI regulation" });

    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run(
      { deliver: true, generateAudio: true },
      { correlationId: "c2", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    expect(output.topics).toEqual(["AI regulation", "Rust"]);

    const stored = briefs.get(output.briefId!, true);
    expect(stored.markdown).toContain("Morning brief");
    expect(stored.sources.length).toBe(2);
    expect(stored.hasAudio).toBe(true);
    expect(stored.audio).toEqual(new Uint8Array([1, 2, 3, 4]));

    expect(tts.requests).toHaveLength(1);
    expect(tts.requests[0]).toContain("Rust");
    expect(tts.requests[0]).not.toContain("http");
    expect(tts.requests[0]).not.toContain("Sources");

    // Summary as formatted text first, then the voice message.
    expect(messaging.sent).toHaveLength(2);
    const summary = messaging.sent[0]!.message;
    expect(summary.kind).toBe("text");
    if (summary.kind === "text") {
      expect(summary.text).toContain("# Morning brief");
      expect(summary.html).toContain("<h2>Morning brief</h2>");
      expect(summary.html).toContain("<h3>Rust</h3>");
    }
    expect(messaging.sent[1]?.message.kind).toBe("voice");

    const topicsEmitted = events.map((event) => event.topic);
    expect(topicsEmitted).toContain("brief.research.started");
    expect(topicsEmitted).toContain("brief.generated");
    expect(topicsEmitted).toContain("tts.synthesized");
    expect(topicsEmitted).toContain("message.text.sent");
    expect(topicsEmitted).toContain("message.voice.sent");
    expect(topicsEmitted).toContain("agent.tool.succeeded");
  });

  test("can generate a brief without audio or delivery", async () => {
    const { workflow, topics, briefs, tts, messaging, statuses } = setup();
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c3", bus: new EventBus(new EventStore(new SqliteDatabase(":memory:")), log), logger: log, statuses },
    );

    expect(output.briefId).toBeTruthy();
    expect(briefs.get(output.briefId!).hasAudio).toBe(false);
    expect(tts.requests).toHaveLength(0);
    expect(messaging.sent).toHaveLength(0);
  });

  test("falls back to text delivery when speech generation fails", async () => {
    const { workflow, topics, briefs, bus, tts, messaging, statuses } = setup();
    topics.add({ name: "Rust" });
    tts.failWith = "ElevenLabs returned HTTP 401";

    const output = await workflow.run(
      { deliver: true, generateAudio: true },
      { correlationId: "c6", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    expect(output.briefId).toBeTruthy();
    expect(output.audioBytes).toBeUndefined();
    expect(briefs.get(output.briefId!).hasAudio).toBe(false);

    expect(tts.requests).toHaveLength(1);
    expect(messaging.sent).toHaveLength(1);
    const message = messaging.sent[0]!.message;
    expect(message.kind).toBe("text");
    if (message.kind === "text") {
      expect(message.text).toContain("# Morning brief");
      expect(message.html).toContain("<h2>Morning brief</h2>");
    }
  });

  test("sends a text notice instead of a brief when nothing was found", async () => {
    const { workflow, topics, briefs, bus, tts, messaging, statuses } = setup({
      webResults: [],
      socialResults: [],
      researchVerdict: false,
    });
    topics.add({ name: "very obscure topic" });

    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run(
      { deliver: true, generateAudio: true },
      { correlationId: "c4", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(true);
    expect(output.reason).toContain("No material");
    expect(briefs.list()).toHaveLength(0);
    expect(tts.requests).toHaveLength(0);

    expect(messaging.sent).toHaveLength(1);
    const message = messaging.sent[0]!.message;
    expect(message.kind).toBe("text");
    if (message.kind === "text") {
      expect(message.text).toContain("No brief today");
      expect(message.text).toContain("very obscure topic");
      expect(message.text).toContain('Queries tried: "t"');
      expect(message.text).toContain("No summary or audio was generated.");
    }

    const skipEvent = events.find((event) => event.topic === "brief.skipped");
    expect(skipEvent?.payload).toMatchObject({ topics: ["very obscure topic"] });
    expect(events.map((event) => event.topic)).not.toContain("brief.generated");
    expect(events.map((event) => event.topic)).not.toContain("tts.synthesized");
  });

  test("ignores irrelevant search results when the researcher reports found=false", async () => {
    // Perplexity returns *something* even for nonsense queries, so the source
    // count alone cannot detect "nothing meaningful" — the agent's verdict must.
    const { workflow, topics, briefs, bus, tts, messaging, statuses } = setup({
      researchVerdict: false,
    });
    topics.add({ name: "zzzuq flurble" });

    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run(
      { deliver: true, generateAudio: true },
      { correlationId: "c5", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(true);
    expect(briefs.list()).toHaveLength(0);
    expect(tts.requests).toHaveLength(0);
    expect(messaging.sent).toHaveLength(1);
    expect(messaging.sent[0]?.message.kind).toBe("text");
    expect(events.map((event) => event.topic)).not.toContain("brief.generated");
    expect(events.map((event) => event.topic)).not.toContain("message.voice.sent");

    const researched = events.find((event) => event.topic === "brief.research.completed");
    expect(researched?.payload).toMatchObject({ found: false });
  });
});

