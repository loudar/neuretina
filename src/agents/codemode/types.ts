import type { Tool, ToolContext } from "../Tool.ts";

/** One run of model-written code in the sandbox. */
export interface CodeModeJob {
  code: string;
  /** Tools reachable from inside the sandbox, keyed by name. */
  tools: Map<string, Tool>;
  context: ToolContext;
  maxToolCalls: number;
}

export interface CodeModeToolCall {
  tool: string;
  args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  durationMs: number;
}

export interface CodeModeOutcome {
  /** The value the program returned (JSON-safe). */
  result: unknown;
  logs: string[];
  toolCalls: CodeModeToolCall[];
}

export interface CodeModeExecutor {
  run(job: CodeModeJob): Promise<CodeModeOutcome>;
}
