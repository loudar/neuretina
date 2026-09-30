/** Parses stored JSON, returning `fallback` when the text is missing or invalid. */
export function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Parses stored JSON that must be a plain object (settings, configs, inputs);
 * arrays, scalars and invalid text fall back to an empty object.
 */
export function parseJsonObject(
  value: string | null | undefined,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> {
  const parsed = parseJsonValue<unknown>(value, fallback);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : fallback;
}

/** Extracts the first JSON object from model output (fenced or noisy). */
export function extractJson<T>(text: string): T | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}
