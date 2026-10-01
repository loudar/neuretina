/**
 * Hosted decision-model connections. Jev (TypeSafe) and Clef (Cloudflare)
 * both speak the SystemOne API — a state plus a schema of typed questions,
 * answered with probabilities — so one generic connection shape covers every
 * provider; the presets only prefill endpoints, model names and labels.
 */
export type DecisionProviderId = "jev" | "clef";

export interface DecisionModelConnection {
  id: string;
  provider: DecisionProviderId;
  /** Model selector sent in the request and shown in the label. */
  model: string;
  /**
   * API base: the full SystemOne endpoint for Jev-compatible servers, or the
   * Cloudflare API base for account-scoped providers.
   */
  baseUrl: string;
  /** Cloudflare account id (account-scoped providers only). */
  accountId?: string;
  apiKey?: string;
}

export interface DecisionProviderPreset {
  /** Display name of the provider, e.g. "TypeSafe". */
  label: string;
  defaultBaseUrl: string;
  defaultModel: string;
  /** Model names the provider ships; the form offers these. */
  models: string[];
  /** Account-scoped (Cloudflare): the URL embeds the account id and model. */
  accountScoped: boolean;
}

export const DECISION_PROVIDER_PRESETS: Record<DecisionProviderId, DecisionProviderPreset> = {
  jev: {
    label: "TypeSafe",
    defaultBaseUrl: "https://api.typesafe.ai/v1/systemone",
    defaultModel: "jev-latest",
    models: ["jev-latest"],
    accountScoped: false,
  },
  clef: {
    label: "Cloudflare",
    defaultBaseUrl: "https://api.cloudflare.com/client/v4",
    defaultModel: "clef",
    models: ["clef", "clef-flash"],
    accountScoped: true,
  },
};

export const DECISION_PROVIDER_IDS = Object.keys(
  DECISION_PROVIDER_PRESETS,
) as DecisionProviderId[];

/** The URL one decision request is posted to; undefined when incomplete. */
export function decisionModelEndpoint(
  connection: DecisionModelConnection,
): string | undefined {
  const preset = DECISION_PROVIDER_PRESETS[connection.provider];
  if (!preset) return undefined;

  const baseUrl = connection.baseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl) return undefined;

  if (preset.accountScoped) {
    const accountId = connection.accountId?.trim();
    if (!accountId) return undefined;
    return `${baseUrl}/accounts/${encodeURIComponent(accountId)}/ai/run/@cf/cloudflare/${encodeURIComponent(connection.model)}`;
  }

  return baseUrl;
}

/** "{provider} - {model name}", e.g. "TypeSafe - jev-latest". */
export function decisionModelLabel(connection: DecisionModelConnection): string {
  const preset = DECISION_PROVIDER_PRESETS[connection.provider];
  return `${preset?.label ?? connection.provider} - ${connection.model}`;
}

/** Shape check for values coming from settings or imported bundles. */
export function isDecisionModelConnection(value: unknown): value is DecisionModelConnection {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.provider !== "string") return false;
  const preset = DECISION_PROVIDER_PRESETS[record.provider as DecisionProviderId];
  if (!preset) return false;
  if (typeof record.model !== "string" || !record.model.trim()) return false;
  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) return false;
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") return false;
  if (record.accountId !== undefined && typeof record.accountId !== "string") return false;
  if (preset.accountScoped && (typeof record.accountId !== "string" || !record.accountId.trim())) {
    return false;
  }
  return true;
}

/** Parses a stored connection list; undefined when the value is not one. */
export function parseDecisionModelConnections(
  value: unknown,
): DecisionModelConnection[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const connections: DecisionModelConnection[] = [];
  for (const entry of value) {
    if (!isDecisionModelConnection(entry)) return undefined;
    connections.push({
      id: entry.id.trim(),
      provider: entry.provider,
      model: entry.model.trim(),
      baseUrl: entry.baseUrl.trim(),
      ...(entry.accountId ? { accountId: entry.accountId.trim() } : {}),
      ...(entry.apiKey ? { apiKey: entry.apiKey } : {}),
    });
  }
  return connections;
}
