import hljs from "highlight.js/lib/core";
import typescript from "highlight.js/lib/languages/typescript";

// Code mode is TypeScript-flavoured JavaScript, and its grammar covers both.
hljs.registerLanguage("typescript", typescript);

/** Parsed tool-call detail: `{ input, output | error }` from the status feed. */
export interface ToolDetail {
  input?: unknown;
  output?: unknown;
  error?: string;
}

/** Tool entries store a JSON `{ input, output|error }` detail. */
export function parseToolDetail(detail: string | undefined): ToolDetail | null {
  if (!detail || !detail.trimStart().startsWith("{")) return null;
  try {
    const parsed = JSON.parse(detail) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === "object" &&
      ("input" in parsed || "output" in parsed || "error" in parsed)
    ) {
      return parsed as ToolDetail;
    }
    return null;
  } catch {
    return null;
  }
}

/** The code-mode program inside a `run_code` input, when present. */
export function codeOf(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const code = (input as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** The tool input without the code, so it is not shown twice. */
export function restOfInput(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const { code: _code, ...rest } = input as Record<string, unknown>;
  return rest;
}

/** Pretty text for an arbitrary detail value. */
export function formatStatusValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value, null, 2);
    return text === undefined ? String(value) : text;
  } catch {
    return String(value);
  }
}

/** Compact USD formatting for feed rows. */
export function formatStatusCost(value: number): string {
  return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
}

/**
 * JavaScript highlighting for code-mode programs (highlight.js). The returned
 * HTML carries `hljs-*` classes, styled with the M3 theme in the activity view.
 */
export function highlightCode(code: string): string {
  return hljs.highlight(code, { language: "typescript", ignoreIllegals: true }).value;
}
