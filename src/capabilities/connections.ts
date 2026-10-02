/**
 * One connection shape shared by every provider capability (LLM, search,
 * finance, decision). Capability modules only supply provider ids and preset
 * data; stored-setting validation, parsing, dedupe and active selection live
 * here once.
 */
export interface Connection {
  id: string;
  provider: string;
  baseUrl: string;
  model?: string;
  accountId?: string;
  apiKey?: string;
}

export interface ConnectionPreset {
  label: string;
  defaultBaseUrl: string;
  defaultModel?: string;
  models?: string[];
  accountScoped?: boolean;
  /** Label for the endpoint field; defaults to "API base URL". */
  endpointLabel?: string;
  /** Set false for keyless providers (local servers). */
  apiKey?: boolean;
}

export type ConnectionPresets = Record<string, ConnectionPreset>;

export function isConnection(value: unknown, presets: ConnectionPresets): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;

  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.provider !== "string") return false;
  const preset = presets[record.provider];
  if (!preset) return false;
  if ((preset.models?.length ?? 0) > 0 && (typeof record.model !== "string" || !record.model.trim())) {
    return false;
  }
  if (typeof record.baseUrl !== "string" || !record.baseUrl.trim()) return false;
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") return false;
  if (record.accountId !== undefined && typeof record.accountId !== "string") return false;
  if (preset.accountScoped && (typeof record.accountId !== "string" || !record.accountId.trim())) {
    return false;
  }
  return true;
}

function normalize<T extends Connection>(record: Connection): T {
  return {
    id: record.id.trim(),
    provider: record.provider,
    baseUrl: record.baseUrl.trim(),
    ...(record.model ? { model: record.model.trim() } : {}),
    ...(record.accountId ? { accountId: record.accountId.trim() } : {}),
    ...(record.apiKey ? { apiKey: record.apiKey } : {}),
  } as T;
}

/**
 * Parses a stored connection list; undefined when invalid. With `uniqueBy`,
 * a repeated provider or id also makes the whole value invalid.
 */
export function parseConnections<T extends Connection>(
  value: unknown,
  presets: ConnectionPresets,
  uniqueBy?: "id" | "provider",
): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const connections: T[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isConnection(entry, presets)) return undefined;
    const record = entry as Connection;
    const key = uniqueBy === "provider" ? record.provider : record.id.trim();
    if (uniqueBy && seen.has(key)) return undefined;
    seen.add(key);
    connections.push(normalize<T>(record));
  }
  return connections;
}

/** Lenient parse for build paths: malformed or repeated rows are dropped. */
export function filterConnections<T extends Connection>(
  value: unknown,
  presets: ConnectionPresets,
  uniqueBy?: "id" | "provider",
): T[] {
  if (!Array.isArray(value)) return [];
  const connections: T[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isConnection(entry, presets)) continue;
    const record = entry as Connection;
    const key = uniqueBy === "provider" ? record.provider : record.id.trim();
    if (uniqueBy && seen.has(key)) continue;
    seen.add(key);
    connections.push(normalize<T>(record));
  }
  return connections;
}

/** The connection single-provider call sites use: the selected id, else the first. */
export function activeConnection<T extends Connection>(
  connections: T[],
  selected?: string,
): T | undefined {
  const list = Array.isArray(connections) ? connections : [];
  return list.find((connection) => connection.id === selected) ?? list[0];
}

/** "{provider label} - {model}", e.g. "OpenAI - gpt-5". */
export function connectionLabel(connection: Connection, presets: ConnectionPresets): string {
  return `${presets[connection.provider]?.label ?? connection.provider} - ${connection.model ?? ""}`;
}
