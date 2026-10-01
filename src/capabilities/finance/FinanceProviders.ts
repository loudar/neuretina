/**
 * Finance-data connections. Perplexity's Agent API returns a synthesized
 * answer plus structured finance blocks; Yahoo Finance serves quote/market
 * data without credentials. One connection per provider keeps the tool names
 * stable (`finance.<provider>`).
 */
export type FinanceProviderId = "perplexity" | "yahoo";

export interface FinanceConnection {
  id: string;
  provider: FinanceProviderId;
  /** API base, e.g. https://api.perplexity.ai. */
  baseUrl: string;
  /** Model selector for providers that take one (Perplexity's Agent API). */
  model?: string;
  apiKey?: string;
}

export interface FinanceProviderPreset {
  /** Display name of the provider, e.g. "Perplexity". */
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Model names the provider ships; empty = the provider takes no model. */
  models: string[];
}

export const FINANCE_PROVIDER_PRESETS: Record<FinanceProviderId, FinanceProviderPreset> = {
  perplexity: {
    label: "Perplexity",
    defaultBaseUrl: "https://api.perplexity.ai",
    defaultModel: "perplexity/glm-5.3-flash",
    models: ["perplexity/glm-5.3-flash"],
  },
  yahoo: {
    label: "Yahoo Finance",
    defaultBaseUrl: "https://query1.finance.yahoo.com",
    defaultModel: "",
    models: [],
  },
};

/** Shape check for values coming from settings or imported bundles. */
export function isFinanceConnection(value: unknown): value is FinanceConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.provider !== "string") return false;
  const preset = FINANCE_PROVIDER_PRESETS[record.provider as FinanceProviderId];
  if (!preset) return false;
  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) return false;
  if (preset.models.length > 0 && (typeof record.model !== "string" || !record.model.trim())) {
    return false;
  }
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") return false;
  return true;
}

/** Parses a stored connection list; undefined when invalid or duplicated. */
export function parseFinanceConnections(
  value: unknown,
): FinanceConnection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const connections: FinanceConnection[] = [];
  const seen = new Set<FinanceProviderId>();
  for (const entry of value) {
    if (!isFinanceConnection(entry) || seen.has(entry.provider)) return undefined;
    seen.add(entry.provider);
    connections.push({
      id: entry.id.trim(),
      provider: entry.provider,
      baseUrl: entry.baseUrl.trim(),
      ...(entry.model ? { model: entry.model.trim() } : {}),
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    });
  }
  return connections;
}
