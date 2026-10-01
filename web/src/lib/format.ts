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

/** Local wall-clock time for activity feeds. */
export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/** Relative time like "5 minutes ago" or "yesterday". */
export function formatRelativeTime(
  ts: number | undefined,
  now = Date.now(),
  locale?: string,
): string {
  if (!ts) return "–";

  const diff = ts - now;
  const abs = Math.abs(diff);
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 365 * 24 * 60 * 60 * 1000],
    ["month", 30 * 24 * 60 * 60 * 1000],
    ["week", 7 * 24 * 60 * 60 * 1000],
    ["day", 24 * 60 * 60 * 1000],
    ["hour", 60 * 60 * 1000],
    ["minute", 60 * 1000],
  ];
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  for (const [unit, ms] of units) {
    if (abs >= ms) return formatter.format(Math.round(diff / ms), unit);
  }
  return formatter.format(0, "second");
}
