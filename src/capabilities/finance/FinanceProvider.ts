import type { SearchResult } from "../search/SearchProvider.ts";

export interface FinanceQuery {
  /** Natural-language business question naming a company or ticker, e.g. "Nvidia's latest quarter revenue and margins". */
  question: string;
  /** Upper bound on the synthesized answer; the provider's default applies when omitted. */
  maxAnswerTokens?: number;
}

export interface FinanceDataItem {
  category: string;
  tickers: string[];
  content: string;
  sources: string[];
}

export interface FinanceUsage {
  inputTokens?: number;
  outputTokens?: number;
  /** Exact cost in USD as reported by the provider. */
  costUsd?: number;
}

export interface FinanceResponse {
  question: string;
  provider: string;
  /** Synthesized answer grounded in the finance data. */
  answer: string;
  /** Structured finance data blocks (quotes, financials, earnings, estimates, …). */
  data: FinanceDataItem[];
  /** Attribution-friendly source pages derived from `data`. */
  results: SearchResult[];
  /** Billing usage for the lookup, when the provider reports it. */
  usage?: FinanceUsage;
}

export interface FinanceProvider {
  readonly name: string;
  lookup(query: FinanceQuery): Promise<FinanceResponse>;
}
