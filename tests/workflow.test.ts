import { describe, expect, test } from "bun:test";
import { BriefingWorkflow } from "../src/workflows/BriefingWorkflow.ts";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
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
  stubFinance,
  stubLlm,
  stubSearch,
} from "./support.ts";

const log = createLogger("test", { level: "error" });

interface SetupOptions {
  webResults?: typeof sampleResults;
  socialResults?: typeof sampleResults;
  financeResults?: typeof sampleResults;
  /** Verdict the research agent reports for its final JSON answer. */
  researchVerdict?: boolean;
  /** The stub researcher reports found=true with empty notes. */
  emptyNotes?: boolean;
  /** Makes the first compiler call return a draft far over the word budget. */
  longCompilerOutput?: boolean;
  /** The stub compiler returns an empty markdown document. */
  emptyCompilerOutput?: boolean;
  /** The stub researcher's program calls only the finance lookup. */
  financeOnly?: boolean;
  /** Enable the follow-up planner/subagents. */
  followups?: boolean;
  /** The stub planner reports nothing worth digging into. */
  noFollowupTasks?: boolean;
  /** The primary-source pass returns these upgrades (and optionally a revision). */
  sourceUpgrades?: {
    markdown?: string;
    upgrades: Array<{ for: number; title: string; url: string }>;
  };
}

function setup(options: SetupOptions = {}) {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  const topics = new TopicRepository(db);
  const briefs = new BriefRepository(new ArtifactRepository(db));
  const compilerInputs: string[] = [];
  const dispatcherInputs: string[] = [];
  let compilerCalls = 0;

  const llm = stubLlm((request) => {
    const system = request.messages[0]?.content ?? "";

    if (system.includes("source upgrades")) {
      return completion(
        JSON.stringify(options.sourceUpgrades ?? { markdown: "", upgrades: [] }),
      );
    }

    if (system.includes("editor")) {
      compilerCalls += 1;
      compilerInputs.push(request.messages[1]?.content ?? "");
      if (options.emptyCompilerOutput) {
        return completion(JSON.stringify({ markdown: "" }));
      }
      if (options.longCompilerOutput && compilerCalls === 1) {
        const filler = Array.from({ length: 200 }, (_, index) => `longfact${index}`).join(" ");
        return completion(JSON.stringify({ markdown: `# Morning brief\n\n${filler}` }));
      }
      return completion(
        JSON.stringify({
          markdown: "# Morning brief\n\n## Rust\nAll quiet.\n\n## AI regulation\nHeated debate.",
        }),
      );
    }

    if (system.includes("follow-up investigations")) {
      dispatcherInputs.push(request.messages[1]?.content ?? "");
      return completion(
        JSON.stringify({
          tasks:
            options.followups && !options.noFollowupTasks
              ? [{ question: "What are the implications for Rust?" }]
              : [],
        }),
      );
    }

    if (system.includes("one specific follow-up question")) {
      const toolMessages = request.messages.filter((message) => message.role === "tool").length;
      if (toolMessages === 0) {
        return completion("", [
          {
            id: "followup-1",
            name: "run_code",
            arguments: {
              code: `async () => {
                const [wiki, web] = await Promise.all([
                  wikipedia_search({ query: "Rust" }),
                  perplexity_search({ query: "Rust implications" }),
                ]);
                return { wiki: wiki.results.length, web: web.results.length };
              }`,
            },
          },
        ]);
      }
      return completion(
        JSON.stringify({
          found: true,
          notes: "Implications: Rust adoption is accelerating https://example.com/article",
        }),
      );
    }

    if (system.includes("Implications")) {
      return completion(
        JSON.stringify({ markdown: "Rust adoption keeps accelerating [1]." }),
      );
    }

    const toolMessages = request.messages.filter((message) => message.role === "tool").length;
    if (toolMessages === 0) {
      const code = options.financeOnly
        ? `async () => {
            const finance = await perplexity_finance({ question: "NVDA quote" });
            return { finance: finance.answer };
          }`
        : `async () => {
            const [web, social] = await Promise.all([
              perplexity_search({ query: "t" }),
              bluesky_search({ query: "t" }),
            ]);
            return { web: web.results.length, social: social.results.length };
          }`;
      return completion("", [{ id: "call-1", name: "run_code", arguments: { code } }]);
    }
    return completion(
      JSON.stringify({
        found: options.researchVerdict ?? true,
        notes: options.emptyNotes
          ? ""
          : "Notes: something happened https://example.com/article",
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
    finance: stubFinance(options.financeResults ?? []),
    tts,
    messaging,
    statuses,
    defaults: {
      recency: "day",
      resultsPerProvider: 5,
      searchDomains: [],
      language: "en",
      followups: options.followups ?? false,
    },
  });

  return { workflow, topics, briefs, bus, tts, messaging, statuses, compilerInputs, dispatcherInputs };
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

    // Narration is derived from the summary, so it matches the written brief.
    expect(stored.narration).toContain("All quiet");
    expect(stored.narration).not.toContain("http");
    expect(stored.narration).not.toContain("Sources");

    expect(tts.requests).toHaveLength(1);
    expect(tts.requests[0]).toContain("All quiet");
    expect(tts.requests[0]).not.toContain("http");
    expect(tts.requests[0]).not.toContain("Sources");

    // Summary as formatted text (with clickable sources) first, then voice.
    expect(messaging.sent).toHaveLength(2);
    const summary = messaging.sent[0]!.message;
    expect(summary.kind).toBe("text");
    if (summary.kind === "text") {
      expect(summary.text).toContain("# Morning brief");
      expect(summary.text).toContain("**Sources**");
      expect(summary.text).toContain("](https://");
      // The spoken narration must not contain the links.
      expect(tts.requests[0]).not.toContain("example.com");
      expect(summary.html).toContain("<h2>Morning brief</h2>");
      expect(summary.html).toContain("<h3>Rust</h3>");
      expect(summary.html).toContain('href="https://example.com/article"');
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
    tts.failWith = "local TTS returned HTTP 500";

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

  test("delivers text only when voice is disabled", async () => {
    const { workflow, topics, briefs, bus, tts, messaging, statuses } = setup();
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: true, generateAudio: false },
      { correlationId: "c11", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    expect(output.audioBytes).toBeUndefined();
    expect(briefs.get(output.briefId!).hasAudio).toBe(false);
    expect(tts.requests).toHaveLength(0);
    expect(messaging.sent).toHaveLength(1);
    expect(messaging.sent[0]?.message.kind).toBe("text");
  });

  test("compresses an over-long draft before delivering", async () => {
    const { workflow, topics, briefs, bus, statuses } = setup({ longCompilerOutput: true });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c10", bus, logger: log, statuses },
    );

    const stored = briefs.get(output.briefId!);
    expect(stored.markdown).toContain("All quiet");
    expect(stored.markdown.split(/\s+/).filter(Boolean).length).toBeLessThan(40);
    expect(stored.narration).toContain("All quiet");
  });

  test("excludes muted topics from briefings", async () => {
    const { workflow, topics, bus, briefs, statuses } = setup();
    const active = topics.add({ name: "Rust" });
    const muted = topics.add({ name: "Crypto" });
    topics.update(muted.id, { muted: true });

    const events: DomainEvent[] = [];
    bus.subscribe("*", (event) => events.push(event));

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c7", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    expect(output.topics).toEqual(["Rust"]);
    expect(briefs.latest()?.topics).toEqual(["Rust"]);
    const researchStarted = events.find((event) => event.topic === "brief.research.started");
    expect(researchStarted?.payload).toMatchObject({ topics: ["Rust"] });

    // Explicitly requesting a muted topic does not bring it back.
    const explicit = await workflow.run(
      { topics: ["Crypto"], deliver: false, generateAudio: false },
      { correlationId: "c8", bus, logger: log, statuses },
    );
    expect(explicit.skipped).toBe(true);

    // Muting everything produces a clear reason.
    topics.update(active.id, { muted: true });
    const allMuted = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c9", bus, logger: log, statuses },
    );
    expect(allMuted.skipped).toBe(true);
    expect(allMuted.reason).toBe("All topics are muted");
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

  test("keeps bluesky post text and media on the stored sources", async () => {
    const social = [
      {
        title: "Alice (@alice.bsky.social)",
        url: "https://bsky.app/profile/alice.bsky.social/post/rkey1",
        snippet: "Local-first is the future",
        source: "bsky.app",
        media: [
          {
            type: "image" as const,
            thumbUrl: "https://cdn.bsky.app/thumb.jpg",
            fullUrl: "https://cdn.bsky.app/full.jpg",
            alt: "a chart",
            width: 1200,
            height: 675,
          },
        ],
      },
    ];
    const { workflow, topics, briefs, bus, statuses } = setup({ socialResults: social });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c13", bus, logger: log, statuses },
    );

    const stored = briefs.get(output.briefId!);
    const source = stored.sources.find((item) => item.url === social[0]!.url);
    expect(source?.snippet).toBe("Local-first is the future");
    expect(source?.media?.[0]).toMatchObject({
      type: "image",
      thumbUrl: "https://cdn.bsky.app/thumb.jpg",
      alt: "a chart",
    });
  });

  test("does not store a brief when the researcher returns empty notes", async () => {
    const { workflow, topics, briefs, bus, statuses } = setup({ emptyNotes: true });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c14", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(true);
    expect(briefs.list()).toHaveLength(0);
  });

  test("fails instead of storing an empty brief when the compiler returns nothing", async () => {
    const { workflow, topics, briefs, bus, statuses } = setup({ emptyCompilerOutput: true });
    topics.add({ name: "Rust" });

    await expect(
      workflow.run(
        { deliver: false, generateAudio: false },
        { correlationId: "c15", bus, logger: log, statuses },
      ),
    ).rejects.toThrow(/empty brief/);
    expect(briefs.list()).toHaveLength(0);
  });

    test("passes the collected sources to the compiler for inline citations", async () => {    const { workflow, topics, bus, statuses, compilerInputs } = setup();
    topics.add({ name: "Rust" });

    await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c16", bus, logger: log, statuses },
    );

    expect(compilerInputs[0]).toContain('"sources"');
    expect(compilerInputs[0]).toContain('"n":1');
    expect(compilerInputs[0]).toContain("Example article");
    expect(compilerInputs[0]).toContain("Another source");
  });

  test("appends the follow-up findings as an Implications section that is also spoken", async () => {
    const { workflow, topics, briefs, bus, statuses, compilerInputs, dispatcherInputs } = setup({
      followups: true,
    });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c17", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    // The planner saw the first draft...
    expect(dispatcherInputs[0]).toContain("All quiet");
    // ...the main brief was not recompiled...
    expect(compilerInputs).toHaveLength(1);
    // ...and the findings were appended and read aloud.
    const stored = briefs.get(output.briefId!);
    expect(stored.markdown).toContain("## Implications");
    expect(stored.markdown).toContain("Rust adoption keeps accelerating");
    expect(stored.narration).toContain("Rust adoption keeps accelerating");
    expect(stored.narration).not.toContain("[1]");
  });

  test("skips the second compile when the planner finds nothing worth digging into", async () => {
    const { workflow, topics, bus, statuses, compilerInputs, dispatcherInputs } = setup({
      followups: true,
      noFollowupTasks: true,
    });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c18", bus, logger: log, statuses },
    );

    expect(output.skipped).toBe(false);
    expect(dispatcherInputs).toHaveLength(1);
    expect(compilerInputs).toHaveLength(1);
  });

  test("upgrades secondary coverage to a primary source after the implications pass", async () => {
    const primary = {
      for: 1,
      title: "Rust 1.90 released",
      url: "https://blog.rust-lang.org/2026/09/01/Rust-1.90.html",
    };
    const { workflow, topics, briefs, bus, statuses } = setup({
      followups: true,
      sourceUpgrades: {
        markdown:
          "# Morning brief\n\n## Rust\nRust 1.90 is out [1].\n\n## Implications\nRust adoption keeps accelerating [1].",
        upgrades: [primary],
      },
    });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c19", bus, logger: log, statuses },
    );

    const stored = briefs.get(output.briefId!);
    expect(stored.sources[0]?.url).toBe(primary.url);
    expect(stored.sources[0]?.title).toBe(primary.title);
    expect(stored.markdown).toContain("Rust 1.90 is out");
    expect(stored.narration).toContain("Rust 1.90 is out");
    expect(stored.narration).not.toContain("[1]");
  });

  test("keeps the draft when the primary-source revision is not acceptable", async () => {
    const { workflow, topics, briefs, bus, statuses } = setup({
      followups: true,
      sourceUpgrades: {
        markdown: "# Rewritten\n\nNope.",
        upgrades: [{ for: 1, title: "Official", url: "https://origin.example.com/a" }],
      },
    });
    topics.add({ name: "Rust" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c20", bus, logger: log, statuses },
    );

    const stored = briefs.get(output.briefId!);
    // The upgrade still lands, but the mangled rewrite is rejected.
    expect(stored.sources[0]?.url).toBe("https://origin.example.com/a");
    expect(stored.markdown).toContain("All quiet");
    expect(stored.markdown).not.toContain("Completely different");
  });

  test("collects finance lookup sources alongside search results", async () => {
    const financeResults = [
      {
        title: "NVDA quote",
        url: "https://www.perplexity.ai/finance/NVDA",
        snippet: "NVDA quote",
        source: "www.perplexity.ai",
      },
    ];
    const { workflow, topics, briefs, bus, statuses } = setup({
      financeOnly: true,
      financeResults,
    });
    topics.add({ name: "Nvidia" });

    const output = await workflow.run(
      { deliver: false, generateAudio: false },
      { correlationId: "c12", bus, logger: log, statuses },
    );

    const stored = briefs.get(output.briefId!);
    const source = stored.sources.find(
      (item) => item.url === "https://www.perplexity.ai/finance/NVDA",
    );
    expect(source).toBeDefined();
    expect(source?.provider).toBe("perplexity");
  });
});

