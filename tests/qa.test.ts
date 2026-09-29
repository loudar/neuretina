import { describe, expect, test } from "bun:test";
import { QuestionAnswerer } from "../src/qa/QuestionAnswerer.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import type { SearchProvider } from "../src/capabilities/search/SearchProvider.ts";
import { completion, stubLlm } from "./support.ts";

const log = createLogger("test", { level: "error" });

describe("QuestionAnswerer", () => {
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
    const answerer = new QuestionAnswerer({
      llm,
      webSearch,
      socialSearch,
      briefs: new BriefRepository(new ArtifactRepository(db)),
      defaults: { recency: "week", resultsPerProvider: 3 },
    });

    const bus = new EventBus(new EventStore(db), log);
    const answer = await answerer.answer("what is X?", {
      correlationId: "q1",
      bus,
      logger: log,
    });

    expect(queries).toEqual(["what is X definition"]);
    expect(answer).toContain("X is a thing people talk about");
    expect(answer).not.toContain("http");
  });
});
