export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  level?: LogLevel;
  json?: boolean;
}

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly options: LoggerOptions = {},
  ) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`, this.options);
  }

  debug(message: string, fields?: Record<string, unknown>): void {
    this.log("debug", message, fields);
  }

  info(message: string, fields?: Record<string, unknown>): void {
    this.log("info", message, fields);
  }

  warn(message: string, fields?: Record<string, unknown>): void {
    this.log("warn", message, fields);
  }

  error(message: string, fields?: Record<string, unknown>): void {
    this.log("error", message, fields);
  }

  private log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    const min = LEVEL_ORDER[this.options.level ?? "info"];
    if (LEVEL_ORDER[level] < min) return;

    const ts = new Date().toISOString();
    if (this.options.json) {
      console.log(JSON.stringify({ ts, level, scope: this.scope, message, ...fields }));
      return;
    }

    const suffix = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    const line = `${ts} ${level.toUpperCase().padEnd(5)} [${this.scope}] ${message}${suffix}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }
}

export function createLogger(scope: string, options?: LoggerOptions): Logger {
  return new Logger(scope, options);
}
