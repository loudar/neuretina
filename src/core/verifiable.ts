/**
 * Optional provider capability: a provider that can verify its own
 * configuration live (credentials, reachable endpoint) without doing real
 * work. Consumers stay provider-agnostic by checking for the method.
 */
export interface Verifiable {
  verify(): Promise<string>;
}

export function isVerifiable<T extends object>(provider: T): provider is T & Verifiable {
  return typeof (provider as Partial<Verifiable>).verify === "function";
}
