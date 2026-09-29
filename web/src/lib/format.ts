export function formatDateTime(ts: number | undefined, fallback = "–"): string {
  return ts ? new Date(ts).toLocaleString() : fallback;
}

/** Compact one-line date + time for list rows. */
export function formatListDate(ts: number | undefined, fallback = "–"): string {
  if (!ts) return fallback;
  return new Date(ts).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
