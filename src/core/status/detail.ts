/**
 * Tool-call details for the activity feed: a JSON `{ input, output | error }`
 * payload the UI renders as input/output (and code) sections.
 *
 * Clipping happens on the values, never on the serialized text, so the detail
 * always stays valid JSON the UI can parse and render as a tree.
 */

/** Longest single string kept (a code program, a snippet, a JSON result). */
export const MAX_STATUS_STRING_CHARS = 20_000;
/** Most array items kept before a "… N more" marker is appended. */
export const MAX_STATUS_ARRAY_ITEMS = 100;

/** Detail for a tool call before it runs: its full input, code included. */
export function toolInputDetail(args: unknown): string {
  return stringify({ input: clipDetail(args ?? {}) });
}

/** Detail once a tool call settled: its input plus output or error. */
export function toolResultDetail(args: unknown, result?: unknown, error?: string): string {
  const payload =
    error !== undefined
      ? { input: args ?? {}, error }
      : { input: args ?? {}, output: result ?? null };
  return stringify(clipDetail(payload));
}

function stringify(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return JSON.stringify({ error: "detail was not JSON-serializable" });
  }
}

/** Clips strings and long arrays while keeping every level valid JSON. */
function clipDetail(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > MAX_STATUS_STRING_CHARS
      ? `${value.slice(0, MAX_STATUS_STRING_CHARS)}…[truncated]`
      : value;
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_STATUS_ARRAY_ITEMS).map(clipDetail);
    if (value.length > MAX_STATUS_ARRAY_ITEMS) {
      items.push(`… ${value.length - MAX_STATUS_ARRAY_ITEMS} more`);
    }
    return items;
  }
  if (value && typeof value === "object") {
    const clipped: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) clipped[key] = clipDetail(entry);
    return clipped;
  }
  return value;
}
