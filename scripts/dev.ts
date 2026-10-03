/**
 * Dev supervisor: restarts a fresh Bun process whenever a source file changes.
 *
 * `bun --watch` reloads in the same process and leaks directory descriptors
 * with every reload (oven-sh/bun#40907). Once the descriptor table crosses
 * macOS's OPEN_MAX (10240), piped `Bun.spawn` calls — code mode, TTS
 * conversion — start failing with EBADF. A new process per restart reclaims
 * the descriptors, so long editing sessions stay healthy.
 */
import { watch } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const entry = process.argv[2] ?? join("src", "index.ts");
const entryPath = resolve(root, entry);

let child: Bun.Subprocess | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

function start(): void {
  const proc = Bun.spawn({
    cmd: [process.execPath, entry],
    cwd: root,
    stdio: ["inherit", "inherit", "inherit"],
  });
  child = proc;
  void proc.exited.then((code) => {
    if (child !== proc) return;
    child = undefined;
    if (code !== 0 && code !== null) console.error(`[dev] server exited with code ${code}`);
  });
}

function restart(): void {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = undefined;
    child?.kill();
    child = undefined;
    console.log("[dev] change detected, restarting…");
    start();
  }, 100);
}

// Tests are not imported by the server; editing them must not restart it.
watch(dirname(entryPath), { recursive: true }, (_event, filename) => {
  if (!filename || filename.endsWith(".test.ts")) return;
  restart();
});

try {
  watch(join(root, ".env"), () => restart());
} catch {
  // No .env file; the environment comes from the shell.
}

start();
