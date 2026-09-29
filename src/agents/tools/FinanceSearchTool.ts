import type {
  FinanceProvider,
  FinanceResponse,
} from "../../capabilities/finance/FinanceProvider.ts";
import type { Tool } from "../Tool.ts";

/**
 * Lets the research agent pull structured financial and market data for
 * public companies and ETFs (quotes, financials, earnings, estimates) through
 * a finance data provider.
 */
export class FinanceSearchTool implements Tool<FinanceResponse> {
  readonly name = "perplexity_finance";
  readonly description =
    "Look up structured financial and market data for public companies and ETFs — quotes, financial statements, earnings, guidance, analyst estimates and ownership. Ask a business question naming the company or ticker, e.g. \"Nvidia's latest quarterly revenue and margins\" or \"Compare Apple and Microsoft on forward P/E\". Returns a synthesized answer plus the underlying data and source links. Use this for concrete market figures instead of generic web results.";
  readonly parameters: Record<string, unknown> = {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "Natural-language business question naming the company or ticker, with a time window when relevant (e.g. \"Tesla's last earnings call, actual vs consensus\").",
      },
    },
    required: ["question"],
  };

  constructor(private readonly provider: FinanceProvider) {}

  async execute(args: Record<string, unknown>): Promise<FinanceResponse> {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    if (!question) throw new Error("`question` is required");

    return this.provider.lookup({ question });
  }
}
