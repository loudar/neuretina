/** The value when it is a finite number, otherwise undefined. */
export function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Reads a non-empty string field from an untyped record (trimmed). */
export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Reads a finite number field from an untyped record. */
export function numberField(record: Record<string, unknown>, key: string): number | undefined {
  return finiteNumber(record[key]);
}
