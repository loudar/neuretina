import { ProviderError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";
import { hostnameOf } from "../search/searchSupport.ts";
import type {
  FinanceDataItem,
  FinanceProvider,
  FinanceQuery,
  FinanceResponse,
} from "../../capabilities/finance/FinanceProvider.ts";
import type { SearchResult } from "../../capabilities/search/SearchProvider.ts";

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string | null;
    shortname?: string | null;
    longname?: string | null;
    quoteType?: string | null;
  }>;
}

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      meta?: {
        symbol?: string | null;
        currency?: string | null;
        longName?: string | null;
        shortName?: string | null;
        exchangeName?: string | null;
        fullExchangeName?: string | null;
        regularMarketPrice?: number | null;
        regularMarketDayHigh?: number | null;
        regularMarketDayLow?: number | null;
        regularMarketVolume?: number | null;
        regularMarketTime?: number | null;
        chartPreviousClose?: number | null;
        previousClose?: number | null;
        fiftyTwoWeekHigh?: number | null;
        fiftyTwoWeekLow?: number | null;
      } | null;
    }>;
    error?: { description?: string | null } | null;
  };
}

export interface YahooFinanceOptions {
  /** API base, e.g. https://query1.finance.yahoo.com. */
  baseUrl: string;
  /** Symbols resolved from one question. */
  maxSymbols?: number;
}

const VOLUME_FORMAT = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/**
 * Yahoo Finance quotes: the public search endpoint resolves tickers from the
 * question, the public chart endpoint serves the latest price, change,
 * ranges and volume — no credentials involved.
 */
export class YahooFinanceProvider implements FinanceProvider {
  readonly name = "yahoo";

  constructor(private readonly options: YahooFinanceOptions) {}

  /** Cheap probe: resolves and quotes one well-known symbol. */
  async verify(): Promise<string> {
    const response = await this.lookup({ question: "AAPL" });
    return `reachable, ${response.data.length} quote(s)`;
  }

  async lookup(query: FinanceQuery): Promise<FinanceResponse> {
    const symbols = await this.resolveSymbols(query.question);
    if (symbols.length === 0) {
      throw new ProviderError(this.name, `no ticker matched "${query.question}"`);
    }

    const settled = await Promise.allSettled(symbols.map((symbol) => this.quote(symbol)));
    const items = settled
      .filter((result): result is PromiseFulfilledResult<FinanceDataItem> => result.status === "fulfilled")
      .map((result) => result.value);
    if (items.length === 0) {
      const reasons = settled
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => (result.reason instanceof Error ? result.reason.message : String(result.reason)));
      throw new ProviderError(this.name, reasons.join("; ") || "no quote data returned");
    }

    const results: SearchResult[] = items.map((item) => {
      const url = `https://finance.yahoo.com/quote/${encodeURIComponent(item.tickers[0] ?? "")}`;
      return {
        title: `${item.tickers.join(", ")} quote`,
        url,
        snippet: item.content.slice(0, 200),
        source: hostnameOf(url),
      };
    });

    return {
      question: query.question,
      provider: this.name,
      answer: items.map((item) => item.content).join("\n\n"),
      data: items,
      results,
    };
  }

  /** Top tickers the Yahoo search endpoint matches for the question text. */
  private async resolveSymbols(question: string): Promise<string[]> {
    const maximum = Math.max(1, this.options.maxSymbols ?? 3);
    const response = await requestJson<YahooSearchResponse>(
      this.name,
      `${this.options.baseUrl}/v1/finance/search?q=${encodeURIComponent(question)}` +
        `&quotesCount=${Math.max(5, maximum)}&newsCount=0&listsCount=0`,
      { headers: this.headers() },
    );

    const symbols: string[] = [];
    for (const quote of response.quotes ?? []) {
      const symbol = quote.symbol?.trim();
      if (!symbol || quote.quoteType === "NONE" || symbols.includes(symbol)) continue;
      symbols.push(symbol);
      if (symbols.length >= maximum) break;
    }
    return symbols;
  }

  private async quote(symbol: string): Promise<FinanceDataItem> {
    const response = await requestJson<YahooChartResponse>(
      this.name,
      `${this.options.baseUrl}/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      { headers: this.headers() },
    );

    const meta = response.chart?.result?.[0]?.meta;
    const price = meta?.regularMarketPrice;
    if (!meta || typeof price !== "number") {
      throw new ProviderError(
        this.name,
        `${symbol}: ${response.chart?.error?.description ?? "no quote data"}`,
      );
    }

    const currency = meta.currency ?? "";
    const previous = meta.chartPreviousClose ?? meta.previousClose;
    const heading = [
      `${symbol} ${meta.longName ?? meta.shortName ?? ""}`.trim(),
      `— ${formatAmount(price)}${currency ? ` ${currency}` : ""}`,
      meta.fullExchangeName ?? meta.exchangeName,
    ]
      .filter(Boolean)
      .join(" ");

    const details: string[] = [];
    if (typeof previous === "number" && previous > 0) {
      const change = price - previous;
      const percent = (change / previous) * 100;
      details.push(
        `previous close ${formatAmount(previous)}, change ${change >= 0 ? "+" : ""}${formatAmount(change)} (${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%)`,
      );
    }
    if (typeof meta.regularMarketDayLow === "number" && typeof meta.regularMarketDayHigh === "number") {
      details.push(`day ${formatAmount(meta.regularMarketDayLow)}–${formatAmount(meta.regularMarketDayHigh)}`);
    }
    if (typeof meta.fiftyTwoWeekLow === "number" && typeof meta.fiftyTwoWeekHigh === "number") {
      details.push(
        `52-week ${formatAmount(meta.fiftyTwoWeekLow)}–${formatAmount(meta.fiftyTwoWeekHigh)}`,
      );
    }
    if (typeof meta.regularMarketVolume === "number") {
      details.push(`volume ${VOLUME_FORMAT.format(meta.regularMarketVolume)}`);
    }
    if (typeof meta.regularMarketTime === "number") {
      details.push(`as of ${new Date(meta.regularMarketTime * 1000).toISOString()}`);
    }

    return {
      category: "quote",
      tickers: [symbol],
      content: [heading, details.join("; ")].filter(Boolean).join("\n"),
      sources: [`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`],
    };
  }

  private headers(): Record<string, string> {
    return { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; neuretina)" };
  }
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
