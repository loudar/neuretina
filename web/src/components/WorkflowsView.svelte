<script lang="ts">
  import { Button, Chip, Icon, ListItem, Select } from "m3-svelte";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import {
    commands,
    type AppContextInfo,
    type WorkflowInfo,
    type WorkflowRunDetail,
    type WorkflowRunInfo,
  } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import { formatDateTime, formatRelativeTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";
  import StatusFeedPanel from "./StatusFeed.svelte";

  let contexts = $state<AppContextInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let runs = $state<WorkflowRunInfo[]>([]);
  let contextFilter = $state("all");
  let selectedWorkflowId = $state<string | null>(null);
  let selected = $state<WorkflowRunDetail | null>(null);

  const contextOptions = $derived([
    { text: "All contexts", value: "all" },
    ...contexts.map((context) => ({ text: context.name, value: context.id })),
  ]);

  const visibleWorkflows = $derived(
    contextFilter === "all" ? workflows : workflows.filter((w) => w.contextId === contextFilter),
  );

  const selectedWorkflow = $derived(
    workflows.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
  );

  async function loadRuns(): Promise<void> {
    runs = selectedWorkflowId
      ? await commands.workflows.runs({ workflow: selectedWorkflowId, limit: 50 })
      : [];
  }

  async function refresh(): Promise<void> {
    try {
      [contexts, workflows] = await Promise.all([
        commands.contexts.list(),
        commands.workflows.list(),
      ]);
      if (selectedWorkflowId && !workflows.some((w) => w.id === selectedWorkflowId)) {
        selectedWorkflowId = null;
        selected = null;
      }
      await loadRuns();
      if (selected) {
        if (!runs.some((run) => run.id === selected.id)) {
          selected = null;
        } else {
          selected = await commands.workflows.runGet(selected.id);
        }
      }
    } catch (error) {
      reportError(error);
    }
  }

  useRefresh(["workflow.", "job.", "artifact.", "context."], refresh);

  $effect(() => {
    // A context filter that hides the selected workflow clears the selection.
    if (selectedWorkflowId && !visibleWorkflows.some((w) => w.id === selectedWorkflowId)) {
      selectedWorkflowId = null;
      selected = null;
      runs = [];
    }
  });

  async function selectWorkflow(workflow: WorkflowInfo): Promise<void> {
    if (selectedWorkflowId === workflow.id) return;
    selectedWorkflowId = workflow.id;
    selected = null;
    try {
      await loadRuns();
    } catch (error) {
      reportError(error);
    }
  }

  async function runNow(id: string): Promise<void> {
    try {
      await commands.workflows.run(id, {}, contextFilter === "all" ? undefined : contextFilter);
    } catch (error) {
      reportError(error);
    }
  }

  async function selectRun(run: WorkflowRunInfo): Promise<void> {
    if (selected?.id === run.id) {
      selected = null;
      return;
    }
    try {
      selected = await commands.workflows.runGet(run.id);
    } catch (error) {
      reportError(error);
    }
  }

  function triggerLabel(run: WorkflowRunInfo): string {
    const detail = run.triggerDetail ?? {};
    const origin =
      (typeof detail.jobName === "string" && detail.jobName) ||
      (typeof detail.sender === "string" && detail.sender) ||
      (typeof detail.source === "string" && detail.source) ||
      undefined;
    return origin ? `${run.trigger} · ${origin}` : run.trigger;
  }

  function durationLabel(run: WorkflowRunInfo): string {
    if (!run.finishedAt) return "running…";
    const ms = run.finishedAt - run.startedAt;
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  }

  function statusChip(status: WorkflowRunInfo["status"]): {
    icon: string;
    label: string;
  } {
    if (status === "running") return { icon: iconBolt, label: "running" };
    if (status === "failed") return { icon: iconError, label: "failed" };
    if (status === "skipped") return { icon: iconSchedule, label: "skipped" };
    return { icon: iconCheck, label: "done" };
  }

  function outputPreview(run: WorkflowRunDetail): string {
    if (run.error) return run.error;
    if (run.output === undefined || run.output === null) return "–";
    const output = run.output as Record<string, unknown>;
    if (typeof output.answer === "string") return output.answer;
    if (typeof output.briefId === "string") return `brief ${output.briefId}`;
    if (typeof output.markdown === "string") return `${output.markdown.slice(0, 200)}…`;
    return JSON.stringify(run.output).slice(0, 300);
  }
</script>

<Pane variant="list" width="19rem" title="Workflows">
  {#snippet actions()}
    <Select label="Context" options={contextOptions} bind:value={contextFilter} />
  {/snippet}

  <DataList items={visibleWorkflows} empty="No workflows in this context.">
    {#snippet children(workflow)}
      <div class="entry" class:selected={selectedWorkflowId === workflow.id}>
        <ListItem
          onclick={() => selectWorkflow(workflow)}
          overline={workflow.contextId ?? "default context"}
          headline={workflow.id}
          supporting={`${workflow.description} · triggers ${workflow.triggers.join(", ") || "none"}`}
        >
          {#snippet leading()}
            <Icon icon={iconSchedule} />
          {/snippet}
          {#snippet trailing()}
            <Button
              variant="tonal"
              iconType="full"
              title="Run now"
              onclick={() => runNow(workflow.id)}
              disabled={!workflow.triggers.includes("manual")}
            >
              <Icon icon={iconPlay} />
            </Button>
          {/snippet}
        </ListItem>
      </div>
    {/snippet}
  </DataList>
</Pane>

<Pane variant="list" width="21rem" title="Runs" subtitle={selectedWorkflow?.id}>
  {#if selectedWorkflow}
    <DataList items={runs} empty="No runs for this workflow yet.">
      {#snippet children(run)}
        <div class="entry" class:selected={selected?.id === run.id}>
          <ListItem
            onclick={() => selectRun(run)}
            overline={triggerLabel(run)}
            headline={`${run.workflow} · ${run.contextId}`}
            supporting={`${formatDateTime(run.startedAt)} · ${durationLabel(run)}`}
          >
            {#snippet leading()}
              <Icon icon={statusChip(run.status).icon} />
            {/snippet}
            {#snippet trailing()}
              <Chip variant="assist" icon={statusChip(run.status).icon}>
                {statusChip(run.status).label}
              </Chip>
            {/snippet}
          </ListItem>
        </div>
      {/snippet}
    </DataList>
  {:else}
    <p class="muted">Select a workflow to see its runs.</p>
  {/if}
</Pane>

<Pane
  variant="detail"
  title={selected ? `Run ${selected.id.slice(0, 8)}` : "Run details"}
  subtitle={selected
    ? `${selected.workflow} · ${selected.contextId} · ${triggerLabel(selected)}`
    : undefined}
>
  {#snippet actions()}
    {#if selected}
      <Chip variant="assist" icon={statusChip(selected.status).icon}>
        {statusChip(selected.status).label}
      </Chip>
      <Chip variant="assist" icon={iconSchedule}>
        {formatRelativeTime(selected.startedAt)}
      </Chip>
    {/if}
  {/snippet}

  {#if selected}
    <p class="preview">{outputPreview(selected)}</p>

    <StatusFeedPanel
      runId={selected.id}
      title="Run activity"
      empty="No activity recorded for this run."
    />

    <h3 class="subhead">Artifacts</h3>
    <DataList items={selected.artifacts} empty="This run produced no artifacts.">
      {#snippet children(artifact)}
        <ListItem
          overline={artifact.kind}
          headline={artifact.name ?? artifact.id.slice(0, 8)}
          supporting={`${artifact.contentType} · ${formatDateTime(artifact.createdAt)}`}
        />
      {/snippet}
    </DataList>
  {:else}
    <p class="muted">Select a run to see its activity, output and artifacts.</p>
  {/if}
</Pane>

<style>
  .subhead {
    margin: 1.25rem 0 0.5rem;
    padding-inline: 0.25rem;
  }

  .entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    border-radius: var(--m3-shape-medium);
    transition: background-color 150ms;
  }

  .entry.selected {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .preview {
    margin: 0 0 1rem;
    overflow-wrap: anywhere;
  }
</style>
