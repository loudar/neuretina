import { fileURLToPath } from "node:url";
import { invokeTool } from "../toolInvocation.ts";
import type {
  CodeModeExecutor,
  CodeModeJob,
  CodeModeOutcome,
  CodeModeToolCall,
} from "./types.ts";

export interface SubprocessExecutorOptions {
  /** Killed when the program produces no activity for this long (runaway loops). */
  idleTimeoutMs?: number;
  /** Absolute wall-clock limit for one program, tool calls included. */
  timeoutMs?: number;
  /** Total sandbox stdout (including tool results) accepted before killing it. */
  maxOutputChars?: number;
}

const WORKER_PATH = fileURLToPath(new URL("./worker.ts", import.meta.url));

/**
 * Runs model-written code in a separate Bun process. Tool calls cross back
 * over stdio and are executed by the host with the real providers.
 */
export function createSubprocessExecutor(
  options: SubprocessExecutorOptions = {},
): CodeModeExecutor {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 60_000;
  const maxOutputChars = options.maxOutputChars ?? 512_000;
  return { run: (job) => runInSubprocess(job, timeoutMs, idleTimeoutMs, maxOutputChars) };
}

async function runInSubprocess(
  job: CodeModeJob,
  timeoutMs: number,
  idleTimeoutMs: number,
  maxOutputChars: number,
): Promise<CodeModeOutcome> {
  const child = Bun.spawn({
    cmd: [process.execPath, WORKER_PATH],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: sandboxEnv(),
  });

  const calls: CodeModeToolCall[] = [];
  let startedCalls = 0;
  let stderrText = "";
  let settled = false;
  let outputChars = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let activeCalls = 0;

  return await new Promise<CodeModeOutcome>((resolve, reject) => {
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(idleTimer);
      child.kill();
      action();
    };

    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Code execution timed out after ${timeoutMs}ms`)));
    }, timeoutMs);

    // Tool execution is host work, not sandbox work: while a call is in flight
    // the idle timer stays off, so slow searches/finance lookups never count
    // as a stall. It only fires when the program itself stops progressing.
    const resetIdle = () => {
      if (settled || activeCalls > 0) return;
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        finish(() => reject(new Error(`Code execution stalled (no activity for ${idleTimeoutMs}ms)`)));
      }, idleTimeoutMs);
    };

    const send = (message: unknown) => {
      if (settled) return;
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`);
        void Promise.resolve(child.stdin.flush()).catch(() => undefined);
      } catch {
        // The child is gone; exit handling reports it.
      }
    };

    const invocation = {
      agent: job.context.agent ?? "codemode",
      source: job.context.agent ? `agent:${job.context.agent}` : "codemode",
      correlationId: job.context.correlationId,
      bus: job.context.bus,
      logger: job.context.logger,
      ...(job.context.statuses ? { statuses: job.context.statuses } : {}),
      ...(job.context.statusId ? { statusId: job.context.statusId } : {}),
    };

    const handleCall = async (message: {
      id: number;
      name: string;
      args: Record<string, unknown>;
    }) => {
      const tool = job.tools.get(message.name);
      if (!tool) {
        const outcome = await invokeTool(undefined, message.name, message.args, invocation);
        send({ type: "result", id: message.id, error: outcome.error });
        resetIdle();
        return;
      }
      if (startedCalls >= job.maxToolCalls) {
        send({
          type: "result",
          id: message.id,
          error: "Tool budget exhausted. Return what you already have.",
        });
        resetIdle();
        return;
      }
      startedCalls += 1;
      activeCalls += 1;
      clearTimeout(idleTimer);

      try {
        const outcome = await invokeTool(tool, message.name, message.args, invocation);
        if (settled) return;
        if (outcome.error !== undefined) {
          calls.push({
            tool: message.name,
            args: message.args,
            error: outcome.error,
            durationMs: outcome.durationMs,
          });
          job.context.logger.warn("code-mode tool failed", {
            tool: message.name,
            error: outcome.error,
          });
          send({ type: "result", id: message.id, error: outcome.error });
        } else {
          calls.push({
            tool: message.name,
            args: message.args,
            result: outcome.result,
            durationMs: outcome.durationMs,
          });
          send({ type: "result", id: message.id, result: outcome.result });
        }
      } finally {
        activeCalls -= 1;
        resetIdle();
      }
    };

    void (async () => {
      const reader = child.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        outputChars += value.byteLength;
        if (outputChars > maxOutputChars) {
          finish(() => reject(new Error("Code execution produced too much output")));
          return;
        }

        buffer += decoder.decode(value, { stream: true });
        let index: number;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.trim()) continue;

          let message: Record<string, unknown>;
          try {
            message = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (message.type === "call") {
            void handleCall(
              message as unknown as { id: number; name: string; args: Record<string, unknown> },
            ).catch(() => undefined);
          } else if (message.type === "done") {
            const logs = Array.isArray(message.logs)
              ? message.logs.filter((item): item is string => typeof item === "string")
              : [];
            finish(() => resolve({ result: message.result, logs, toolCalls: calls }));
          } else if (message.type === "error") {
            const error = typeof message.error === "string" ? message.error : "code execution failed";
            const logs = Array.isArray(message.logs)
              ? message.logs.filter((item): item is string => typeof item === "string").slice(-5)
              : [];
            const detail = logs.length > 0 ? `\nLogs:\n${logs.join("\n")}` : "";
            finish(() => reject(new Error(`${error}${detail}`)));
          }
        }
      }
    })();

    void (async () => {
      const reader = child.stderr.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (stderrText.length < 2000) stderrText += decoder.decode(value, { stream: true });
      }
    })();

    void child.exited.then((code) => {
      finish(() =>
        reject(
          new Error(
            `Code sandbox exited with code ${code}${stderrText ? `: ${stderrText.trim().slice(0, 300)}` : ""}`,
          ),
        ),
      );
    });

    send({ type: "job", code: job.code, tools: [...job.tools.keys()] });
    resetIdle();
  });
}

/** Only the essentials: the sandbox must never see engine credentials. */
function sandboxEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["PATH", "SystemRoot", "TEMP", "TMP", "HOME"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
