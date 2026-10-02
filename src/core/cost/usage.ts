/**
 * USD a provider reported in a response's usage object. Covers the shapes in
 * the wild: OpenAI-style `cost.total_cost`, a flat `total_cost`, a numeric
 * `cost`, and Perplexity's per-request `request_cost`.
 */
export function reportedCostUsd(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const record = usage as Record<string, unknown>;
  const nested =
    record.cost && typeof record.cost === "object"
      ? (record.cost as Record<string, unknown>).total_cost
      : undefined;
  for (const value of [record.cost, record.total_cost, nested, record.request_cost]) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}
