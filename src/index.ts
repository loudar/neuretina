import { createKernel } from "./kernel/Kernel.ts";
import { errorMessage } from "./core/errors.ts";

const kernel = await createKernel();

process.on("unhandledRejection", (reason) => {
  kernel.logger.error("unhandled rejection", { error: errorMessage(reason) });
});

process.on("uncaughtException", (error) => {
  kernel.logger.error("uncaught exception", { error: errorMessage(error) });
});

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    kernel.logger.info(`received ${signal}, shutting down`);
    void kernel.shutdown().then(() => process.exit(0));
  });
}

  kernel.logger.info("neuretina started", {
  port: kernel.api.port,
  jobs: kernel.scheduler.registeredCount,
  workflows: kernel.workflows.list().map((workflow) => workflow.id),
});
