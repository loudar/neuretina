import { describe, expect, test } from "bun:test";
import {
  isFinanceConnection,
  parseFinanceConnections,
} from "../src/capabilities/finance/FinanceProviders.ts";
import {
  isSearchConnection,
  parseSearchConnections,
} from "../src/capabilities/search/SearchProviders.ts";
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
