import {
  FINANCE_PROVIDER_PRESETS,
  type FinanceConnection,
} from "../../capabilities/finance/FinanceProviders.ts";
import { filterConnections } from "../../capabilities/connections.ts";
import type { FinanceProvider } from "../../capabilities/finance/FinanceProvider.ts";
import { PerplexityFinanceProvider } from "./PerplexityFinanceProvider.ts";
import { YahooFinanceProvider } from "./YahooFinanceProvider.ts";

/** One provider per configured connection; malformed rows are skipped. */
export function createFinanceProviders(connections: FinanceConnection[]): FinanceProvider[] {
  return filterConnections<FinanceConnection>(
    connections,
    FINANCE_PROVIDER_PRESETS,
    "provider",
  ).map((connection) => createFinanceProvider(connection));
}

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
