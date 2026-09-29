export type StatusState = "running" | "done" | "failed";

export interface StatusEntry {
  id: string;
  activityId: string;
  correlationId?: string;
  text: string;
  detail?: string;
  state: StatusState;
  startedAt: number;
  updatedAt: number;
}

export type StatusMessage =
  | { type: "snapshot"; entries: StatusEntry[] }
  | { type: "entry"; entry: StatusEntry };
