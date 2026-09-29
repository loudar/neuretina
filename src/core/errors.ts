export class AppError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(message: string, options: { code?: string; cause?: unknown; details?: Record<string, unknown> } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = options.code ?? "APP_ERROR";
    this.details = options.details;
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: "CONFIGURATION_ERROR", details });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: "VALIDATION_ERROR", details });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { code: "NOT_FOUND", details });
  }
}

export class ProviderError extends AppError {
  readonly provider: string;
  readonly status?: number;

  constructor(
    provider: string,
    message: string,
    options: { status?: number; cause?: unknown; details?: Record<string, unknown> } = {},
  ) {
    super(`[${provider}] ${message}`, { code: "PROVIDER_ERROR", cause: options.cause, details: options.details });
    this.provider = provider;
    this.status = options.status;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
