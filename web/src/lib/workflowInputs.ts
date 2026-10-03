import type { Component } from "svelte";
import type { Topic, WorkflowInputInfo } from "./api";
import WorkflowInputTopics from "../components/WorkflowInputTopics.svelte";

/** Props every workflow input editor receives; values are input ids. */
export interface WorkflowInputEditorProps {
  spec: WorkflowInputInfo;
  topics: Topic[];
  values: string[];
  disabled?: boolean;
  /** Cap the editor with its own scrollbar (dialog); the details tab grows. */
  capped?: boolean;
  onchange: (values: string[]) => void;
}

/** One editor per input kind; registering a kind here makes it editable. */
export const WORKFLOW_INPUT_EDITORS: Record<string, Component<WorkflowInputEditorProps>> = {
  topics: WorkflowInputTopics,
};
