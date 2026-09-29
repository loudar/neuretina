import type { Logger } from "../logger.ts";
import type { EventBus } from "../events/EventBus.ts";
import { errorMessage } from "../errors.ts";

export type CheckStatus = "ok" | "failed" | "skipped";

export interface CheckOutcome {
  status: CheckStatus;
  detail: string;
}

export interface StartupCheck {
  name: string;
  timeoutMs?: number;
  run(): CheckOutcome | Promise<CheckOutcome>;
}

export interface CheckResult extends CheckOutcome {
  name: string;
  durationMs: number;
}

export interface StartupReport {
  startedAt: number;
  durationMs: number;
  ok: boolean;
  results: CheckResult[];
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Runs a set of named checks with per-check timeouts, emitting an event per
 * check plus a summary. Checks never throw; failures become results.
 */
export class StartupValidator {
  constructor(
    private readonly deps: {
      bus: EventBus;
      logger: Logger;
      checks: StartupCheck[];
      defaultTimeoutMs?: number;
    },
  ) {}

  async run(): Promise<StartupReport> {
    const startedAt = Date.now();
    const results: CheckResult[] = [];

    for (const check of this.deps.checks) {
      results.push(await this.runCheck(check));
    }

    const failed = results.filter((result) => result.status === "failed").map((result) => result.name);
    const skipped = results
      .filter((result) => result.status === "skipped")
      .map((result) => result.name);

    const report: StartupReport = {
      startedAt,
      durationMs: Date.now() - startedAt,
      ok: failed.length === 0,
      results,
    };

    this.deps.bus.publish(
      "system.validation.completed",
      { ok: report.ok, checks: results.length, failed, skipped },
      { source: "startup" },
    );

    return report;
  }

  private async runCheck(check: StartupCheck): Promise<CheckResult> {
    const started = Date.now();
    const timeoutMs = check.timeoutMs ?? this.deps.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    let outcome: CheckOutcome;

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        Promise.resolve(check.run()),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`check timed out after ${timeoutMs}ms`)),
            timeoutMs,
          );
        }),
      ]);
    } catch (error) {
      outcome = { status: "failed", detail: errorMessage(error) };
    } finally {
      if (timer) clearTimeout(timer);
    }

    const result: CheckResult = { name: check.name, ...outcome, durationMs: Date.now() - started };

    this.deps.bus.publish(
      "system.check.completed",
      {
        name: result.name,
        status: result.status,
        detail: result.detail,
        durationMs: result.durationMs,
      },
      { source: "startup" },
    );

    if (result.status === "failed") {
      this.deps.logger.warn("startup check failed", { name: result.name, detail: result.detail });
    } else {
      this.deps.logger.info("startup check", {
        name: result.name,
        status: result.status,
        detail: result.detail,
      });
    }

    return result;
  }
}
