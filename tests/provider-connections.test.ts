import { describe, expect, test } from "bun:test";
import {
  isFinanceConnection,
  parseFinanceConnections,
} from "../src/capabilities/finance/FinanceProviders.ts";
import {
  activeSearchConnection,
  isSearchConnection,
  parseSearchConnections,
} from "../src/capabilities/search/SearchProviders.ts";
import {
  activeLlmConnection,
  isLlmConnection,
  isLlmConnectionConfigured,
  parseLlmConnections,
} from "../src/capabilities/llm/LlmProviders.ts";
import { createFinanceProviders } from "../src/providers/finance/createFinanceProvider.ts";
import { createSearchProviders } from "../src/providers/search/createSearchProvider.ts";

describe("search connections", () => {
  test("parses one connection per provider and rejects duplicates or unknown providers", () => {
    const connections = [
      { id: "a", provider: "perplexity" as const, baseUrl: "https://api.perplexity.ai", apiKey: "k" },
      { id: "b", provider: "exa" as const, baseUrl: "https://api.exa.ai" },
    ];
    expect(parseSearchConnections(connections)).toEqual(connections);
    expect(
      parseSearchConnections([
        ...connections,
        { id: "c", provider: "perplexity", baseUrl: "https://duplicate" },
      ]),
    ).toBeUndefined();
    expect(parseSearchConnections([{ id: "a", provider: "brave", baseUrl: "https://x" }])).toBeUndefined();
    expect(parseSearchConnections([{ id: "a", provider: "exa", baseUrl: "" }])).toBeUndefined();
    expect(parseSearchConnections("nope")).toBeUndefined();
    expect(isSearchConnection({ id: "a", provider: "exa", baseUrl: "https://api.exa.ai" })).toBe(true);
  });

  test("builds one provider per connection and skips invalid or duplicate rows", () => {
    const providers = createSearchProviders([
      { id: "a", provider: "perplexity", baseUrl: "https://api.perplexity.ai", apiKey: "k" },
      { id: "b", provider: "perplexity", baseUrl: "https://duplicate" },
      { id: "c", provider: "exa", baseUrl: "https://api.exa.ai" },
    ]);

    expect(providers.map((provider) => provider.name)).toEqual(["perplexity", "exa"]);
  });

  test("selects the active connection, falling back to the first", () => {
    const connections = [
      { id: "a", provider: "perplexity" as const, baseUrl: "https://api.perplexity.ai" },
      { id: "b", provider: "exa" as const, baseUrl: "https://api.exa.ai" },
    ];

    expect(activeSearchConnection(connections, "b")?.id).toBe("b");
    expect(activeSearchConnection(connections, "missing")?.id).toBe("a");
    expect(activeSearchConnection([], "b")).toBeUndefined();
  });
});

describe("llm connections", () => {
  test("parses provider+model pairings and rejects unknown or incomplete rows", () => {
    const connections = [
      {
        id: "a",
        provider: "openai" as const,
        model: "gpt-5",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "k",
      },
      {
        id: "b",
        provider: "ollama" as const,
        model: "llama3.3",
        baseUrl: "http://localhost:11434/v1",
      },
    ];
    expect(parseLlmConnections(connections)).toEqual(connections);
    expect(
      parseLlmConnections([{ id: "c", provider: "nope", model: "m", baseUrl: "https://x" }]),
    ).toBeUndefined();
    expect(
      parseLlmConnections([{ id: "c", provider: "openai", model: "", baseUrl: "https://x" }]),
    ).toBeUndefined();
    expect(parseLlmConnections([connections[0], connections[0]])).toBeUndefined();
    expect(parseLlmConnections("nope")).toBeUndefined();
    expect(isLlmConnection(connections[1])).toBe(true);
  });

  test("selects the active connection and treats keyless providers as configured", () => {
    const connections = [
      {
        id: "a",
        provider: "openai" as const,
        model: "gpt-5",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "k",
      },
      {
        id: "b",
        provider: "ollama" as const,
        model: "llama3.3",
        baseUrl: "http://localhost:11434/v1",
      },
    ];

    expect(activeLlmConnection(connections, "b")?.id).toBe("b");
    expect(activeLlmConnection(connections, "missing")?.id).toBe("a");
    expect(activeLlmConnection([], "b")).toBeUndefined();

    expect(isLlmConnectionConfigured(connections[0])).toBe(true);
    expect(isLlmConnectionConfigured(connections[1])).toBe(true);
    expect(
      isLlmConnectionConfigured({
        id: "c",
        provider: "openai",
        model: "gpt-5",
        baseUrl: "https://api.openai.com/v1",
      }),
    ).toBe(false);
    expect(isLlmConnectionConfigured(undefined)).toBe(false);
  });
});

describe("finance connections", () => {
  test("requires a model exactly for the providers that take one", () => {
    expect(
      isFinanceConnection({
        id: "a",
        provider: "perplexity",
        baseUrl: "https://api.perplexity.ai",
        model: "perplexity/glm-5.3-flash",
      }),
    ).toBe(true);
    expect(
      isFinanceConnection({ id: "a", provider: "perplexity", baseUrl: "https://api.perplexity.ai" }),
    ).toBe(false);
    expect(
      isFinanceConnection({ id: "b", provider: "yahoo", baseUrl: "https://query1.finance.yahoo.com" }),
    ).toBe(true);
  });

  test("parses the keyless Yahoo connection and builds every provider", () => {
    const connections = parseFinanceConnections([
      { id: "y", provider: "yahoo", baseUrl: "https://query1.finance.yahoo.com" },
      {
        id: "p",
        provider: "perplexity",
        baseUrl: "https://api.perplexity.ai",
        model: "perplexity/glm-5.3-flash",
        apiKey: "k",
      },
    ]);

    expect(connections).toEqual([
      { id: "y", provider: "yahoo", baseUrl: "https://query1.finance.yahoo.com" },
      {
        id: "p",
        provider: "perplexity",
        baseUrl: "https://api.perplexity.ai",
        model: "perplexity/glm-5.3-flash",
        apiKey: "k",
      },
    ]);
    expect(createFinanceProviders(connections ?? []).map((provider) => provider.name)).toEqual([
      "yahoo",
      "perplexity",
    ]);
  });
});
