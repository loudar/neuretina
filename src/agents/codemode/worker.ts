/**
 * Code-mode sandbox worker.
 *
 * Runs in its own Bun process with a stripped environment. It evaluates the
 * model-written program and reaches the host's tools only through
 * newline-delimited JSON on stdio: the program can never see API keys, and
 * network, process and filesystem-style globals are removed before it runs.
 *
 * This is a sandbox of convenience, not a hardened security boundary — the
 * host also screens the code and keeps a timeout on the process.
 */

interface Job {
  code: string;
  tools: string[];
}

interface ResultMessage {
  type: "result";
  id: number;
  result?: unknown;
  error?: string;
}

type Incoming = { type: "job"; code: string; tools: string[] } | ResultMessage;

const stdout = process.stdout;
const stdin = Bun.stdin.stream().getReader();
const decoder = new TextDecoder();

const writeLine = (message: unknown): void => {
  stdout.write(`${JSON.stringify(message)}\n`);
};

const MAX_LOGS = 100;
const logs: string[] = [];

function pushLog(text: string): void {
  if (logs.length < MAX_LOGS) logs.push(text.slice(0, 2000));
}

function formatLog(values: unknown[]): string {
  return values
    .map((value) => {
      if (typeof value === "string") return value;
      try {
        const text = JSON.stringify(value);
        return text === undefined ? String(value) : text;
      } catch {
        return String(value);
      }
    })
    .join(" ");
}

const sandboxConsole = {
  log: (...values: unknown[]) => pushLog(formatLog(values)),
  info: (...values: unknown[]) => pushLog(formatLog(values)),
  warn: (...values: unknown[]) => pushLog(formatLog(values)),
  error: (...values: unknown[]) => pushLog(formatLog(values)),
  debug: (...values: unknown[]) => pushLog(formatLog(values)),
};

const pending = new Map<number, (value: unknown) => void>();
let nextId = 1;

function callTool(name: string, args: unknown): Promise<unknown> {
  const id = nextId++;
  writeLine({ type: "call", id, name, args: args ?? {} });
  return new Promise((resolve) => {
    pending.set(id, resolve);
  });
}

/**
 * A failed tool call resolves to this instead of throwing, so one flaky
 * provider (a 502 from Bluesky, a finance timeout, …) can never abort the
 * whole program — `Promise.all` still completes and the code can carry on
 * with whatever succeeded.
 */
function failedCall(error: string): Record<string, unknown> {
  return { error, results: [], briefs: [], data: [], answer: "" };
}

let jobResolve: ((job: Job) => void) | undefined;
const jobReady = new Promise<Job>((resolve) => {
  jobResolve = resolve;
});

function handleLine(line: string): void {
  let message: Incoming;
  try {
    message = JSON.parse(line) as Incoming;
  } catch {
    return;
  }

  if (message.type === "job") {
    jobResolve?.({ code: message.code, tools: message.tools });
    return;
  }

  if (message.type === "result") {
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(typeof message.error === "string" ? failedCall(message.error) : message.result);
  }
}

void (async () => {
  let buffer = "";
  while (true) {
    const { done, value } = await stdin.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) handleLine(line);
    }
  }
})();

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
  ...args: string[]
) => (...values: unknown[]) => Promise<unknown>;

/** Models often wrap the program in a markdown fence; unwrap it before parsing. */
function unwrapFence(code: string): string {
  const match = code.match(/^\s*```[^\n]*\n([\s\S]*?)\n?\s*```\s*$/);
  return (match?.[1] ?? code).trim();
}

/**
 * `new AsyncFunction` reports bare messages ("Parser error") that say nothing
 * about what was wrong. Add the error name, the offending program and how it
 * must be shaped, so the model can fix its code on the next attempt.
 */
function describeParseFailure(error: unknown, code: string): Error {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const excerpt = code.length > 400 ? `${code.slice(0, 400)}…` : code;
  return new Error(
    `Could not parse the program (${name}: ${message}). ` +
      `The code must be an async arrow function or a function body.\nProgram:\n${excerpt}`,
  );
}

// Cut the program off from everything except the tool functions before it runs.
for (const key of [
  "fetch",
  "WebSocket",
  "XMLHttpRequest",
  "process",
  "Bun",
  "require",
  "module",
  "Deno",
  "eval",
  "Function",
]) {
  try {
    delete (globalThis as Record<string, unknown>)[key];
  } catch {
    // non-configurable in this runtime; the host screens for these names too
  }
}
(globalThis as Record<string, unknown>).console = sandboxConsole;

async function runProgram(job: Job): Promise<void> {
  // Dotted tool names (e.g. search.perplexity) become namespaced objects so
  // the program can call them naturally; plain names stay top-level functions.
  const plain: Array<[string, (args: unknown) => unknown]> = [];
  const namespaces = new Map<string, Record<string, (args: unknown) => unknown>>();
  for (const name of job.tools) {
    const call = (args: unknown) => callTool(name, args);
    const dot = name.indexOf(".");
    if (dot > 0) {
      const namespace = name.slice(0, dot);
      const bucket = namespaces.get(namespace) ?? {};
      bucket[name.slice(dot + 1)] = call;
      namespaces.set(namespace, bucket);
    } else {
      plain.push([name, call]);
    }
  }
  const params = [...plain.map(([name]) => name), ...namespaces.keys()];
  const values = [...plain.map(([, call]) => call), ...namespaces.values()];
  const code = unwrapFence(job.code);

  let program: (...values: unknown[]) => Promise<unknown>;
  try {
    const factory = new AsyncFunction(...params, `"use strict"; return (${code}\n);`);
    const candidate = await factory(...values);
    if (typeof candidate !== "function") throw new Error("not a function");
    program = candidate as (...values: unknown[]) => Promise<unknown>;
  } catch {
    // Not an expression yielding a function: treat the code as the function body.
    try {
      program = new AsyncFunction(...params, `"use strict";\n${code}`) as unknown as (
        ...values: unknown[]
      ) => Promise<unknown>;
    } catch (error) {
      throw describeParseFailure(error, code);
    }
  }

  const result = await program(...values);
  writeLine({ type: "done", result: toJsonSafe(result), logs });
}

function toJsonSafe(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    const text = JSON.stringify(value);
    return text === undefined ? null : JSON.parse(text);
  } catch {
    return { error: "the returned value was not JSON-serializable" };
  }
}

jobReady.then(runProgram).catch((error: unknown) => {
  writeLine({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
    logs,
  });
});
