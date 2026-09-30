/** ISO calendar date (YYYY-MM-DD) for a timestamp; defaults to now. */
export function isoDate(timestamp: number = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}
