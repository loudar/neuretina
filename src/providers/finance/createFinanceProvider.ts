import {
  isFinanceConnection,
  type FinanceConnection,
  type FinanceProviderId,
} from "../../capabilities/finance/FinanceProviders.ts";
import type { FinanceProvider } from "../../capabilities/finance/FinanceProvider.ts";
import { PerplexityFinanceProvider } from "./PerplexityFinanceProvider.ts";
import { YahooFinanceProvider } from "./YahooFinanceProvider.ts";

/** One provider per configured connection; malformed and duplicate rows are skipped. */
export function createFinanceProviders(connections: FinanceConnection[]): FinanceProvider[] {
  if (!Array.isArray(connections)) return [];
  const providers: FinanceProvider[] = [];
  const seen = new Set<FinanceProviderId>();
  for (const connection of connections) {
    if (!isFinanceConnection(connection) || seen.has(connection.provider)) continue;
    seen.add(connection.provider);
    providers.push(createFinanceProvider(connection));
  }
  return providers;
}

/** Builds the concrete provider for one finance-data connection. */
export function createFinanceProvider(connection: FinanceConnection): FinanceProvider {
  switch (connection.provider) {
    case "perplexity":
      return new PerplexityFinanceProvider({
        apiKey: connection.apiKey,
        baseUrl: connection.baseUrl,
        ...(connection.model ? { model: connection.model } : {}),
      });
    case "yahoo":
      return new YahooFinanceProvider({ baseUrl: connection.baseUrl });
  }
}
