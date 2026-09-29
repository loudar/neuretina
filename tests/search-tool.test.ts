import { describe, expect, test } from "bun:test";
import { SearchTool } from "../src/agents/tools/SearchTool.ts";
import type { SearchProvider, SearchQuery } from "../src/capabilities/search/SearchProvider.ts";

function recordingProvider(): { provider: SearchProvider; queries: SearchQuery[] } {
  const queries: SearchQuery[] = [];
  return {
    queries,
    provider: {
      name: "perplexity",
      kind: "web",
      search: async (query) => {
        queries.push(query);
        return { query: query.query, provider: "perplexity", kind: "web", results: [] };
      },
    },
  };
}

function schemaProperties(tool: SearchTool): Record<string, unknown> {
  return tool.parameters.properties as Record<string, unknown>;
}

describe("SearchTool domain allowlist", () => {
  test("passes the reputable domains by default", async () => {
    const { provider, queries } = recordingProvider();
    const tool = new SearchTool({ provider, domains: ["wikipedia.org", "reuters.com"] });

    await tool.execute({ query: "climate policy" });

    expect(queries[0]?.domains).toEqual(["wikipedia.org", "reuters.com"]);
    expect(schemaProperties(tool).scope).toBeDefined();
    expect(tool.description).toContain("reputable");
  });

  test("scope open searches without the allowlist", async () => {
    const { provider, queries } = recordingProvider();
    const tool = new SearchTool({ provider, domains: ["wikipedia.org"] });

    await tool.execute({ query: "rust release notes", scope: "open" });

    expect(queries[0]?.domains).toBeUndefined();
  });

  test("no domains configured means no filter and no scope parameter", async () => {
    const { provider, queries } = recordingProvider();
    const tool = new SearchTool({ provider, domains: [] });

    await tool.execute({ query: "x", scope: "open" });

    expect(queries[0]?.domains).toBeUndefined();
    expect(schemaProperties(tool).scope).toBeUndefined();
    expect(tool.description).not.toContain("reputable");
  });

  test("applies the default recency and language to every query", async () => {
    const { provider, queries } = recordingProvider();
    const tool = new SearchTool({ provider, defaultRecency: "3days", defaultLanguage: "en" });

    await tool.execute({ query: "x" });

    expect(queries[0]?.recency).toBe("3days");
    expect(queries[0]?.language).toBe("en");
  });
});
