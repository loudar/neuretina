import { dirname, join } from "node:path";
import { loadConfig } from "../config/env.ts";
import { AuthService } from "../auth/AuthService.ts";
import { createLogger } from "../core/logger.ts";
import { errorMessage } from "../core/errors.ts";
import { SqliteDatabase } from "../infra/db/SqliteDatabase.ts";
import { UserRepository, type UserStore } from "../domain/users/UserRepository.ts";
import {
  createRuntime,
  type KernelOverrides,
  type KernelRuntime,
} from "./Runtime.ts";
import { createApiServer, type ApiServer } from "../api/server.ts";

export type { KernelStores, KernelOverrides, KernelRuntime } from "./Runtime.ts";

export interface Kernel extends Omit<KernelRuntime, "stop"> {
  /** Accounts; each one owns a runtime (and, except for the admin, a database). */
  users: UserStore;
  auth: AuthService;
  /** Account that owns the main database and the global password login. */
  adminUser: string;
  /** Runtime of an account; created (and its database opened) on first access. */
  runtimeFor(username: string): KernelRuntime;
  api: ApiServer;
  shutdown(): Promise<void>;
}

/**
 * Composition root. The control plane owns the main database (accounts plus
 * the admin's data); every other account gets its own database file, which is
 * what keeps each user's data viewable only by that user.
 */
export async function createKernel(overrides: KernelOverrides = {}): Promise<Kernel> {
  const config = overrides.config ?? loadConfig();
  const env = overrides.env ?? (overrides.config ? {} : Bun.env);
  const logger = overrides.logger ?? createLogger("kernel", { level: config.logLevel });

  const overridden = overrides.stores ?? {};
  const needsSqlite =
    !overridden.events ||
    !overridden.contexts ||
    !overridden.runs ||
    !overridden.artifacts ||
    !overridden.topics ||
    !overridden.reports ||
    !overridden.jobs ||
    !overridden.kv ||
    !overridden.deliveries ||
    !overridden.userWorkflows ||
    !overridden.timelineEvents;
  const db = needsSqlite ? new SqliteDatabase(config.dbPath) : null;
  // Accounts always need a database, even when every runtime store is swapped.
  const controlDb = db ?? new SqliteDatabase(":memory:");

  const users = overrides.users ?? new UserRepository(controlDb);
  const adminUser = config.auth.adminUsername || "admin";
  users.ensure(adminUser, "Admin");

  const auth = new AuthService({ config });

  const runtimes = new Map<string, KernelRuntime>();
  const runtimeFor = (username: string): KernelRuntime => {
    // Sessions minted before accounts existed carried the "global" subject.
    const requested = username === "global" ? adminUser : username;
    const cached = runtimes.get(requested);
    if (cached) return cached;

    users.ensure(requested);

    const runtime =
      requested === adminUser
        ? createRuntime({
            user: requested,
            config,
            env,
            logger,
            db,
            ownsDb: false,
            overrides,
            legacyMigrations: true,
            runStartup: true,
          })
        : createRuntime({
            user: requested,
            // A fresh config clone per account: settings changes must not leak.
            config: structuredClone(config),
            env,
            logger,
            db: new SqliteDatabase(userDatabasePath(config.dbPath, requested)),
            ownsDb: true,
            overrides: {},
            legacyMigrations: false,
            runStartup: false,
          });

    runtimes.set(requested, runtime);
    return runtime;
  };

  const adminRuntime = runtimeFor(adminUser);

  // Every existing account runs its own scheduler and Matrix listener.
  for (const account of users.list()) {
    if (account.id === adminUser) continue;
    try {
      runtimeFor(account.id);
    } catch (error) {
      logger.error("opening a user runtime failed", {
        user: account.id,
        error: errorMessage(error),
      });
    }
  }

  const api = createApiServer({
    config,
    auth,
    logger,
    bus: adminRuntime.bus,
    adminUser,
    runtimeFor: (username) => runtimeFor(username),
    // Share tokens are per account; find the runtime that owns the report.
    sharedReport: (token) => {
      for (const runtime of runtimes.values()) {
        const report = runtime.reports.findByShareToken(token);
        if (!report) continue;
        return {
          report,
          audio: () => runtime.reports.getAudio(report.id),
          timeline: () => {
            const artifact = report.artifacts.find((entry) => entry.kind === "timeline");
            if (!artifact) return null;
            const ids = Array.isArray(artifact.metadata.eventIds)
              ? artifact.metadata.eventIds.filter(
                  (id): id is string => typeof id === "string" && id.length > 0,
                )
              : [];
            return {
              artifact,
              events: ids.length > 0 ? runtime.events.list({ ids }) : [],
            };
          },
        };
      }
      return null;
    },
  });

  adminRuntime.bus.publish(
    "system.ready",
    {
      port: api.port,
      jobs: adminRuntime.scheduler.registeredCount,
      workflows: adminRuntime.workflows.list().map((workflow) => workflow.id),
    },
    { source: "kernel" },
  );

  let stopped = false;
  const shutdown = async () => {
    if (stopped) return;
    stopped = true;
    api.stop();
    for (const runtime of runtimes.values()) runtime.stop();
    controlDb.close();
  };

  return {
    user: adminRuntime.user,
    config: adminRuntime.config,
    logger: adminRuntime.logger,
    db: adminRuntime.db,
    bus: adminRuntime.bus,
    store: adminRuntime.store,
    contexts: adminRuntime.contexts,
    runs: adminRuntime.runs,
    artifacts: adminRuntime.artifacts,
    topics: adminRuntime.topics,
    reports: adminRuntime.reports,
    jobs: adminRuntime.jobs,
    deliveries: adminRuntime.deliveries,
    userWorkflows: adminRuntime.userWorkflows,
    events: adminRuntime.events,
    settings: adminRuntime.settings,
    workflows: adminRuntime.workflows,
    runner: adminRuntime.runner,
    scheduler: adminRuntime.scheduler,
    commands: adminRuntime.commands,
    statuses: adminRuntime.statuses,
    get messaging() {
      return adminRuntime.messaging;
    },
    get tts() {
      return adminRuntime.tts;
    },
    users,
    auth,
    adminUser,
    runtimeFor,
    api,
    shutdown,
  };
}

/** Each account's data lives in its own SQLite file next to the main one. */
function userDatabasePath(dbPath: string, user: string): string {
  const dir = dbPath === ":memory:" ? join(process.cwd(), "data") : dirname(dbPath);
  return join(dir, "users", `${user}.db`);
}
