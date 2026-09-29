export function formatDateTime(ts: number | undefined, fallback = "–"): string {
  return ts ? new Date(ts).toLocaleString() : fallback;
}
