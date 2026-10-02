export type StatusState = "running" | "done" | "failed";
/** Rendering hint: a coarse task/step, or one tool call with its I/O. */
export type StatusKind = "task" | "tool";

export interface StatusEntry {
  id: string;
  activityId: string;
  correlationId?: string;
  /** Entry this one runs under (e.g. an agent step under its research span). */
  parentId?: string;
  text: string;
  /** Free text for tasks; JSON `{ input, output | error }` for tool calls. */
  detail?: string;
  kind?: StatusKind;
  state: StatusState;
  costUsd?: number;
  startedAt: number;
  updatedAt: number;
}

export type StatusMessage =
  | { type: "snapshot"; entries: StatusEntry[] }
  | { type: "entry"; entry: StatusEntry };
