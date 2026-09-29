export type StatusState = "running" | "done" | "failed";

export interface StatusEntry {
  id: string;
  activityId: string;
  correlationId?: string;
  /** Entry this one runs under (e.g. an agent step under its research span). */
  parentId?: string;
  text: string;
  detail?: string;
  state: StatusState;
  startedAt: number;
  updatedAt: number;
}

export type StatusMessage =
  | { type: "snapshot"; entries: StatusEntry[] }
  | { type: "entry"; entry: StatusEntry };
