import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { PerplexityFinanceProvider } from "../src/providers/finance/PerplexityFinanceProvider.ts";
import { YahooFinanceProvider } from "../src/providers/finance/YahooFinanceProvider.ts";
import { FinanceSearchTool } from "../src/agents/tools/FinanceSearchTool.ts";
import { ConfigurationError } from "../src/core/errors.ts";
import type {
  FinanceProvider,
  FinanceQuery,
} from "../src/capabilities/finance/FinanceProvider.ts";

const fetchSpy = spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
});

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

const agentResponse = {
  status: "completed",
  error: null,
  output: [
    {
      type: "finance_results",
      categories: ["quote"],
      tickers: ["NVDA"],
      results: [
        {
          category: "quote",
          tickers: ["NVDA"],
          content: "## NVDA Quote\n| price |\n| 200.23 |",
          sources: [
            "https://www.perplexity.ai/finance/NVDA/historical-data",
            "https://www.perplexity.ai/finance/NVDA",
          ],
        },
      ],
    },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "NVIDIA is trading at $200.23." }],
    },
  ],
};

describe("PerplexityFinanceProvider", () => {
  test("sends a finance_search agent request and parses data, answer and sources", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    mockFetch(async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify(agentResponse), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new PerplexityFinanceProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });

    const response = await provider.lookup({ question: "What is NVIDIA trading at?" });

    expect(url).toBe("https://api.perplexity.ai/v1/agent");
    expect(body.input).toBe("What is NVIDIA trading at?");
    expect(body.tools).toEqual([{ type: "finance_search" }]);
    expect(body.model).toBe("perplexity/glm-5.3-flash");
    expect(Number(body.max_steps)).toBeGreaterThanOrEqual(3);
    expect(Number(body.max_output_tokens)).toBeGreaterThanOrEqual(4096);
    expect(body.reasoning).toEqual({ effort: "low" });

    expect(response.provider).toBe("perplexity");
    expect(response.answer).toContain("$200.23");
    expect(response.data).toHaveLength(1);
    expect(response.data[0]).toMatchObject({ category: "quote", tickers: ["NVDA"] });
    expect(response.results).toHaveLength(2);
    expect(response.results[0]).toMatchObject({
      url: "https://www.perplexity.ai/finance/NVDA/historical-data",
      source: "www.perplexity.ai",
    });
  });

  test("fails clearly when the API key is missing", async () => {
    const provider = new PerplexityFinanceProvider({ baseUrl: "https://api.perplexity.ai" });
    await expect(provider.lookup({ question: "NVDA quote" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
  });

  test("reports an empty agent response with the API's own explanation", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            status: "failed",
            error: { message: "finance_search is not enabled for this key" },
            output: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const provider = new PerplexityFinanceProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });
    await expect(provider.lookup({ question: "NVDA quote" })).rejects.toThrow(
      "finance_search is not enabled for this key",
    );
  });

  test("retries an incomplete run with a larger output budget", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    mockFetch(async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const payload =
        bodies.length === 1
          ? { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] }
          : agentResponse;
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const provider = new PerplexityFinanceProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });
    const response = await provider.lookup({ question: "NVIDIA quote" });

    expect(bodies).toHaveLength(2);
    expect(Number(bodies[1]!.max_output_tokens)).toBeGreaterThan(
      Number(bodies[0]!.max_output_tokens),
    );
    expect(response.answer).toContain("$200.23");
  });

  test("surfaces why an incomplete run produced nothing", async () => {
    mockFetch(
      async () =>
        new Response(
          JSON.stringify({
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );

    const provider = new PerplexityFinanceProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });
    await expect(provider.lookup({ question: "NVDA quote" })).rejects.toThrow("max_output_tokens");
  });
});

describe("FinanceSearchTool", () => {
  test("requires a question and delegates to the provider", async () => {
    const seen: FinanceQuery[] = [];
    const provider: FinanceProvider = {
      name: "perplexity",
      lookup: async (query) => {
        seen.push(query);
        return {
          question: query.question,
          provider: "perplexity",
          answer: "ok",
          data: [],
          results: [],
        };
      },
    };
    const tool = new FinanceSearchTool(provider);

    expect(tool.name).toBe("finance.perplexity");
    await expect(tool.execute({})).rejects.toThrow("`question` is required");

    const response = await tool.execute({ question: "  Nvidia revenue? " });
    expect(seen).toEqual([{ question: "Nvidia revenue?" }]);
    expect(response.answer).toBe("ok");
  });
});

describe("YahooFinanceProvider", () => {
  const chart = {
    chart: {
      result: [
        {
          meta: {
            symbol: "NVDA",
            currency: "USD",
            longName: "NVIDIA Corporation",
            fullExchangeName: "NasdaqGS",
            regularMarketPrice: 120.5,
            chartPreviousClose: 119,
            regularMarketDayLow: 118.2,
            regularMarketDayHigh: 121.4,
            fiftyTwoWeekLow: 86.6,
            fiftyTwoWeekHigh: 140.8,
            regularMarketVolume: 180_200_000,
            regularMarketTime: 1_759_280_400,
          },
        },
      ],
    },
  };

  test("resolves tickers from the question and quotes them", async () => {
    const calls: Array<{ url: string; headers: RequestInit["headers"] }> = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      calls.push({ url, headers: init?.headers });
      if (url.includes("/v1/finance/search")) {
        return Response.json({
          quotes: [
            { symbol: "NVDA", quoteType: "EQUITY" },
            { symbol: "NVDA", quoteType: "EQUITY" },
            { symbol: "AMD", quoteType: "EQUITY" },
          ],
        });
      }
      if (url.includes("/v8/finance/chart/")) return Response.json(chart);
      return new Response("not found", { status: 404 });
    });

    const provider = new YahooFinanceProvider({ baseUrl: "https://query1.finance.yahoo.test" });
    const response = await provider.lookup({ question: "How is Nvidia doing?" });

    expect(calls.map((call) => call.url)).toEqual([
      "https://query1.finance.yahoo.test/v1/finance/search?q=How%20is%20Nvidia%20doing%3F&quotesCount=5&newsCount=0&listsCount=0",
      "https://query1.finance.yahoo.test/v8/finance/chart/NVDA?range=1d&interval=1d",
      "https://query1.finance.yahoo.test/v8/finance/chart/AMD?range=1d&interval=1d",
    ]);
    expect((calls[0]?.headers as Record<string, string>)["User-Agent"]).toContain("Mozilla");

    expect(response.provider).toBe("yahoo");
    expect(response.data).toHaveLength(2);
    expect(response.data[0]).toMatchObject({ category: "quote", tickers: ["NVDA"] });
    expect(response.data[0]?.content).toContain("NVDA NVIDIA Corporation — 120.50 USD NasdaqGS");
    expect(response.data[0]?.content).toContain("previous close 119.00, change +1.50 (+1.26%)");
    expect(response.data[0]?.content).toContain("52-week 86.60–140.80");
    expect(response.data[0]?.content).toContain("volume 180.2M");
    expect(response.answer).toContain("NVDA NVIDIA Corporation");
    expect(response.results[0]).toMatchObject({
      url: "https://finance.yahoo.com/quote/NVDA",
      source: "finance.yahoo.com",
    });
  });

  test("fails clearly when no ticker matches", async () => {
    mockFetch(async () =>
      Response.json({ quotes: [{ symbol: "??", quoteType: "NONE" }] }),
    );

    const provider = new YahooFinanceProvider({ baseUrl: "https://query1.finance.yahoo.test" });
    await expect(provider.lookup({ question: "the weather" })).rejects.toThrow(
      "no ticker matched",
    );
  });

  test("verify quotes one well-known symbol", async () => {
    mockFetch(async (input) => {
      const url = String(input);
      if (url.includes("/v1/finance/search")) {
        return Response.json({ quotes: [{ symbol: "AAPL", quoteType: "EQUITY" }] });
      }
      return Response.json({ chart: { result: [{ meta: { ...chart.chart.result[0]!.meta, symbol: "AAPL" } }] } });
    });

    const provider = new YahooFinanceProvider({ baseUrl: "https://query1.finance.yahoo.test" });
    await expect(provider.verify()).resolves.toBe("reachable, 1 quote(s)");
  });
});
