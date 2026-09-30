import { describe, expect, test } from "bun:test";
import { buildQuestionPrompt, QuestionWorkflow } from "../src/workflows/QuestionWorkflow.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import { StatusHub } from "../src/core/status/StatusHub.ts";
import type { SearchProvider } from "../src/capabilities/search/SearchProvider.ts";
import { completion, stubLlm } from "./support.ts";

const log = createLogger("test", { level: "error" });

describe("QuestionWorkflow", () => {
  test("searches, answers concisely and strips URLs", async () => {
    const queries: string[] = [];
    const webSearch: SearchProvider = {
      name: "perplexity",
      kind: "web",
      search: async (query) => {
        queries.push(query.query);
        return {
          query: query.query,
          provider: "perplexity",
          kind: "web",
          results: [
            {
              title: "Definition of X",
              url: "https://example.com/x",
              snippet: "X is a thing",
              source: "example.com",
            },
          ],
        };
      },
    };
    const socialSearch: SearchProvider = {
      name: "bluesky",
      kind: "social",
      search: async (query) => ({
        query: query.query,
        provider: "bluesky",
        kind: "social",
        results: [],
      }),
    };

    const llm = stubLlm((request) =>
      request.messages.some((message) => message.role === "tool")
        ? completion("X is a thing people talk about. More at https://example.com/x")
        : completion("", [
            { id: "call-1", name: "perplexity_search", arguments: { query: "what is X definition" } },
          ]),
    );

    const db = new SqliteDatabase(":memory:");
    const workflow = new QuestionWorkflow({
      llm,
      webSearch,
      socialSearch,
      briefs: new BriefRepository(new ArtifactRepository(db)),
      defaults: { recency: "week", resultsPerProvider: 3, language: "en", searchDomains: [] },
    });

    const bus = new EventBus(new EventStore(db), log);
    const result = await workflow.run(
      { question: "what is X?" },
      { correlationId: "q1", bus, logger: log, statuses: new StatusHub() },
    );

    expect(queries).toEqual(["what is X definition"]);
    expect(result.answer).toContain("X is a thing people talk about");
    expect(result.answer).not.toContain("http");
  });

  test("only triggers on replies to the bot", () => {
    const [binding] = new QuestionWorkflow({
      llm: stubLlm(() => completion("x")),
      webSearch: { name: "web", kind: "web", search: async (q) => ({ query: q.query, provider: "web", kind: "web", results: [] }) },
      socialSearch: { name: "social", kind: "social", search: async (q) => ({ query: q.query, provider: "social", kind: "social", results: [] }) },
      briefs: new BriefRepository(new ArtifactRepository(new SqliteDatabase(":memory:"))),
      defaults: { recency: "week", resultsPerProvider: 3, language: "en", searchDomains: [] },
    }).definition.triggers;

    expect(binding?.kind).toBe("matrix");
    expect(binding?.when?.({ replyToBot: true })).toBe(true);
    expect(binding?.when?.({ replyToBot: false })).toBe(false);
    expect(binding?.when?.({})).toBe(false);
  });

  test("buildQuestionPrompt includes the reply chain oldest first", () => {
    const prompt = buildQuestionPrompt({
      question: "what about that?",
      chain: [
        { sender: "@user:test", body: "any news on X?", fromBot: false },
        { sender: "@bot:test", body: "X shipped today.", fromBot: true },
      ],
    });

    expect(prompt).toContain("Conversation context (oldest first):");
    expect(prompt.indexOf("any news on X?")).toBeLessThan(prompt.indexOf("X shipped today."));
    expect(prompt).toContain("me: X shipped today.");
    expect(prompt).toContain("Follow-up question: what about that?");
  });
});
