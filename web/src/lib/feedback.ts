import { snackbar } from "m3-svelte";

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Shows an error in a snackbar (the M3 feedback pattern). */
export function reportError(error: unknown): void {
  snackbar(errorText(error), undefined, true);
}

/** Shows a short success message in a snackbar. */
export function reportSuccess(message: string): void {
  snackbar(message, undefined, true);
}
