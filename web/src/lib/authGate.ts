/**
 * Decouples the API client from the auth UI: `send()` reports 401s here and
 * the auth state subscribes, without the two modules importing each other.
 */
type UnauthorizedHandler = () => void;

let handler: UnauthorizedHandler | null = null;

export function onUnauthorized(callback: UnauthorizedHandler): void {
  handler = callback;
}

export function notifyUnauthorized(): void {
  handler?.();
}
