import { describe, expect, test } from "bun:test";
import { BriefingWorkflow } from "../src/workflows/BriefingWorkflow.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { TopicRepository } from "../src/domain/topics/TopicRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
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

function setup() {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const topics = new TopicRepository(db);
  const briefs = new BriefRepository(db);

  const llm = stubLlm((request) => {
    const system = request.messages[0]?.content ?? "";

    if (system.includes("editor")) {
      return completion(
        JSON.stringify({
          markdown: "# Morning brief\n\n## Rust\nAll quiet. [1]\n\n## AI regulation\nHeated debate. [2]",
          narration: "Rust is quiet today. AI regulation is being debated.",
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
    return completion("Notes: something happened https://example.com/article");
  });

  const tts = new StubTts();
  const messaging = new StubMessaging();

  const workflow = new BriefingWorkflow({
    topics,
    briefs,
    llm,
    webSearch: stubSearch("perplexity", "web", sampleResults),
    socialSearch: stubSearch("bluesky", "social", [sampleResults[1]!]),
    tts,
    messaging,
    defaults: { recency: "day", resultsPerProvider: 5, language: "en" },
  });

  return { workflow, topics, briefs, bus, tts, messaging };
}

describe("BriefingWorkflow", () => {
  test("skips cleanly when no topics are configured", async () => {
    const { workflow, bus } = setup();
    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run({}, { correlationId: "c1", bus, logger: log });

    expect(output.skipped).toBe(true);
    expect(events.some((event) => event.topic === "brief.skipped")).toBe(true);
  });

  test("researches topics, compiles a brief, synthesizes audio and delivers it", async () => {
    const { workflow, topics, briefs, bus, tts, messaging } = setup();
    topics.add({ name: "Rust" });
    topics.add({ name: "AI regulation" });

    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run(
      { deliver: true, generateAudio: true },
      { correlationId: "c2", bus, logger: log },
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

    expect(messaging.sent).toHaveLength(1);
    expect(messaging.sent[0]?.message.kind).toBe("voice");

    const topicsEmitted = events.map((event) => event.topic);
    expect(topicsEmitted).toContain("brief.research.started");
    expect(topicsEmitted).toContain("brief.generated");
    expect(topicsEmitted).toContain("tts.synthesized");
    expect(topicsEmitted).toContain("message.voice.sent");
    expect(topicsEmitted).toContain("agent.tool.succeeded");
  });

  test("can generate a brief without audio or delivery", async () => {
    const { workflow, topics, briefs, tts, messaging } = setup();
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c3", bus: new EventBus(new EventStore(new SqliteDatabase(":memory:")), log), logger: log },
    );

    expect(output.briefId).toBeTruthy();
    expect(briefs.get(output.briefId!).hasAudio).toBe(false);
    expect(tts.requests).toHaveLength(0);
    expect(messaging.sent).toHaveLength(0);
  });
});
