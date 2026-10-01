import { hostnameOf } from "../search/searchSupport.ts";
import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";
import type {
  FinanceDataItem,
  FinanceProvider,
  FinanceQuery,
  FinanceResponse,
  FinanceUsage,
} from "../../capabilities/finance/FinanceProvider.ts";
import type { SearchResult } from "../../capabilities/search/SearchProvider.ts";

interface PerplexityAgentResponse {
  output?: PerplexityAgentItem[];
  error?: { message?: string } | null;
  status?: string;
  incomplete_details?: { reason?: string } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cost?: number | { total_cost?: number } | null;
  };
}

interface PerplexityAgentItem {
  type?: string;
  categories?: string[];
  tickers?: string[];
  results?: Array<{
    category?: string;
    tickers?: string[];
    content?: string;
    sources?: string[];
  }>;
  content?: Array<{ type?: string; text?: string }>;
}

export interface PerplexityFinanceOptions {
  apiKey?: string;
  baseUrl: string;
  /** Model the Agent API routes the lookup to. */
  model?: string;
  /** Agent loop steps; the docs require at least 3 for finance_search. */
  maxSteps?: number;
  maxAnswerTokens?: number;
}

/**
 * Financial lookups through Perplexity's Agent API
 * (`POST /v1/agent` with the `finance_search` tool). Unlike the Search API
 * this returns a synthesized answer plus structured data blocks (quotes,
 * financials, earnings, estimates) with citation-ready Perplexity Finance
 * source links.
 */
export class PerplexityFinanceProvider implements FinanceProvider {
  readonly name = "perplexity";

  constructor(private readonly options: PerplexityFinanceOptions) {}

  /** Live probe: one small finance lookup through the Agent API. */
  async verify(): Promise<string> {
    const response = await this.lookup({ question: "Nvidia share price" });
    return `reachable, ${response.data.length} data block(s)`;
  }

  async lookup(query: FinanceQuery): Promise<FinanceResponse> {
    if (!this.options.apiKey) {
      throw new ConfigurationError(
        "The Perplexity finance connection has no API key.",
      );
    }

    const maxAnswerTokens =
      query.maxAnswerTokens ?? this.options.maxAnswerTokens ?? DEFAULT_MAX_ANSWER_TOKENS;
    let response = await this.request(query, maxAnswerTokens);
    let data = collectFinanceData(response.output ?? []);
    let answer = clip(collectAnswer(response.output ?? []), MAX_ANSWER_CHARS);

    // A reasoning model that burns its whole output budget stops with
    // "incomplete" and nothing usable; one retry with a larger budget recovers it.
    if (data.length === 0 && !answer && response.status === "incomplete") {
      response = await this.request(query, Math.max(maxAnswerTokens * 2, RETRY_MAX_ANSWER_TOKENS));
      data = collectFinanceData(response.output ?? []);
      answer = clip(collectAnswer(response.output ?? []), MAX_ANSWER_CHARS);
    }

    if (data.length === 0 && !answer) {
      const detail =
        response.error?.message ??
        incompleteDetail(response) ??
        `the agent returned no finance data (status ${response.status ?? "unknown"})`;
      throw new ProviderError(this.name, detail);
    }

    return {
      question: query.question,
      provider: this.name,
      answer,
      data,
      results: collectSources(data),
      usage: parseUsage(response.usage),
    };
  }

  private async request(
    query: FinanceQuery,
    maxAnswerTokens: number,
  ): Promise<PerplexityAgentResponse> {
    const payload: Record<string, unknown> = {
      model: this.options.model ?? DEFAULT_MODEL,
      input: query.question,
      tools: [{ type: "finance_search" }],
      max_steps: Math.max(3, this.options.maxSteps ?? DEFAULT_MAX_STEPS),
      max_output_tokens: maxAnswerTokens,
      // Finance lookups are factual: low effort keeps reasoning tokens from
      // crowding out the answer on models that default to high/max effort.
      reasoning: { effort: "low" },
    };

    return requestJson<PerplexityAgentResponse>(this.name, `${this.options.baseUrl}/v1/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  }
}

/** Best open-weight model on Vals AI Finance Agent v2; cheapest capable option on Perplexity. */
const DEFAULT_MODEL = "perplexity/glm-5.3-flash";
/** Docs recommend at least 3 steps so finance_search can initialize and run. */
const DEFAULT_MAX_STEPS = 5;
/** The API default; reasoning tokens count against it, so keep headroom. */
const DEFAULT_MAX_ANSWER_TOKENS = 8192;
/** Retry budget when an incomplete run produced nothing usable. */
const RETRY_MAX_ANSWER_TOKENS = 16_384;
/** Keep the tool result compact: the agent serializes at most 8000 chars. */
const MAX_ANSWER_CHARS = 2800;
const MAX_CONTENT_CHARS = 2000;
const MAX_DATA_CHARS = 4000;

function incompleteDetail(response: PerplexityAgentResponse): string | undefined {
  const reason = response.incomplete_details?.reason;
  return reason ? `the agent stopped before answering (${reason})` : undefined;
}

function parseUsage(usage: PerplexityAgentResponse["usage"]): FinanceUsage | undefined {
  if (!usage) return undefined;
  const cost =
    typeof usage.cost === "number" ? usage.cost : usage.cost?.total_cost;
  const result: FinanceUsage = {
    ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}),
    ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}),
    ...(typeof cost === "number" ? { costUsd: cost } : {}),
  };
  return Object.keys(result).length > 0 ? result : undefined;
}

function collectFinanceData(output: PerplexityAgentItem[]): FinanceDataItem[] {
  const items: FinanceDataItem[] = [];
  let budget = MAX_DATA_CHARS;

  for (const entry of output) {
    if (!Array.isArray(entry.results)) continue;
    for (const block of entry.results) {
      const content = typeof block.content === "string" ? block.content.trim() : "";
      if (!content || budget <= 0) continue;

      const clipped = content.slice(0, Math.min(MAX_CONTENT_CHARS, budget));
      budget -= clipped.length;
      items.push({
        category: block.category ?? entry.categories?.[0] ?? "finance",
        tickers: strings(block.tickers ?? entry.tickers),
        content: clipped,
        sources: strings(block.sources).filter((source) => source.startsWith("http")),
      });
    }
  }

  return items;
}

/** The Agent API answers in `message` items; join them across steps. */
function collectAnswer(output: PerplexityAgentItem[]): string {
  const texts: string[] = [];
  for (const entry of output) {
    if (!Array.isArray(entry.content)) continue;
    for (const block of entry.content) {
      const text = typeof block.text === "string" ? block.text.trim() : "";
      if (text) texts.push(text);
    }
  }
  return texts.join("\n\n").trim();
}

function collectSources(data: FinanceDataItem[]): SearchResult[] {
  const seen = new Set<string>();
  const results: SearchResult[] = [];

  for (const item of data) {
    const title = labelOf(item);
    for (const url of item.sources) {
      if (seen.has(url)) continue;
      seen.add(url);
      results.push({ title, url, snippet: title, source: hostnameOf(url) });
    }
  }

  return results;
}

function labelOf(item: FinanceDataItem): string {
  const who = item.tickers.length > 0 ? item.tickers.join(", ") : "Finance";
  return `${who} ${item.category}`;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function clip(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/** Finance sources share the search-result hostname helper. */
