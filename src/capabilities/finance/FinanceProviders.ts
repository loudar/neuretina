import {
  isConnection,
  parseConnections,
  type Connection,
  type ConnectionPreset,
} from "../connections.ts";

/**
 * Perplexity's Agent API returns a synthesized answer plus structured finance
 * blocks; Yahoo Finance serves quote/market data without credentials. One
 * connection per provider keeps the tool names stable (`finance.<provider>`).
 */
export type FinanceProviderId = "perplexity" | "yahoo";

export interface FinanceConnection extends Connection {
  provider: FinanceProviderId;
}

export const FINANCE_PROVIDER_PRESETS: Record<FinanceProviderId, ConnectionPreset> = {
  perplexity: {
    label: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModel: "perplexity/glm-5.3-flash",
    models: ["perplexity/glm-5.3-flash"],
  },
  yahoo: {
    label: "Yahoo Finance",
    defaultBaseUrl: "https://query1.finance.yahoo.com",
    models: [],
  },
};

export const FINANCE_PROVIDER_IDS = Object.keys(FINANCE_PROVIDER_PRESETS) as FinanceProviderId[];

export function isFinanceConnection(value: unknown): value is FinanceConnection {
  return isConnection(value, FINANCE_PROVIDER_PRESETS);
}

export function parseFinanceConnections(value: unknown): FinanceConnection[] | undefined {
  return parseConnections<FinanceConnection>(value, FINANCE_PROVIDER_PRESETS, "provider");
}
