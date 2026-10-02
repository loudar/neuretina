import {
  connectionLabel,
  isConnection,
  parseConnections,
  type Connection,
  type ConnectionPreset,
} from "../connections.ts";

/**
 * Jev (TypeSafe) and Clef (Cloudflare) both speak the SystemOne API — a state
 * plus a schema of typed questions, answered with probabilities.
 */
export type DecisionProviderId = "jev" | "clef";

export interface DecisionModelConnection extends Connection {
  provider: DecisionProviderId;
  model: string;
}

export const DECISION_PROVIDER_PRESETS: Record<DecisionProviderId, ConnectionPreset> = {
  jev: {
    label: "TypeSafe",
    defaultBaseUrl: "https://api.typesafe.ai/v1/systemone",
    defaultModel: "jev-latest",
    models: ["jev-latest"],
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

export function decisionModelLabel(connection: DecisionModelConnection): string {
  return connectionLabel(connection, DECISION_PROVIDER_PRESETS);
}

export function isDecisionModelConnection(value: unknown): value is DecisionModelConnection {
  return isConnection(value, DECISION_PROVIDER_PRESETS);
}

export function parseDecisionModelConnections(
  value: unknown,
): DecisionModelConnection[] | undefined {
  return parseConnections<DecisionModelConnection>(value, DECISION_PROVIDER_PRESETS);
}
