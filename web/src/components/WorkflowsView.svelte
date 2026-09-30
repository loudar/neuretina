<script lang="ts">
  import { Button, Chip, Dialog, Icon, ListItem, Select } from "m3-svelte";
  import iconChevronRight from "@ktibow/iconset-material-symbols/chevron-right";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import {
    commands,
    type AppContextInfo,
    type ArtifactInfo,
    type WorkflowInfo,
    type WorkflowRunDetail,
    type WorkflowRunInfo,
  } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime, formatRelativeTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import ArtifactDrawer from "./ArtifactDrawer.svelte";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";
  import RunStatusIcon from "./RunStatusIcon.svelte";
  import StatusFeedPanel from "./StatusFeed.svelte";

  let contexts = $state<AppContextInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let runs = $state<WorkflowRunInfo[]>([]);
  let selected = $state<WorkflowRunDetail | null>(null);
  let openedArtifact = $state<ArtifactInfo | null>(null);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  // URL scheme: /workflows[/:workflowId[/:runId]] with ?context= and ?artifact=.
  const route = $derived(router.current);
  const workflowId = $derived(route.segments[0] ?? null);
  const runId = $derived(route.segments[1] ?? null);
  const contextFilter = $derived(route.query.context ?? "all");

  let context = $state(contextFilter);
  $effect(() => {
    if (contextFilter !== context) context = contextFilter;
  });

  const contextOptions = $derived([
    { text: "All contexts", value: "all" },
    ...contexts.map((entry) => ({ text: entry.name, value: entry.id })),
  ]);

  const visibleWorkflows = $derived(
    contextFilter === "all" ? workflows : workflows.filter((w) => w.contextId === contextFilter),
  );

  const selectedWorkflow = $derived(
    workflows.find((workflow) => workflow.id === workflowId) ?? null,
  );

  /** Query for the current view state; `null` drops the artifact parameter. */
  function workflowQuery(artifact: string | null = null): { context?: string; artifact?: string } {
    return {
      context: contextFilter === "all" ? undefined : contextFilter,
      artifact: artifact ?? undefined,
    };
  }

  async function loadRuns(id: string): Promise<void> {
    try {
      const loaded = await commands.workflows.runs({ workflow: id, limit: 50 });
      if (workflowId !== id) return;
      runs = loaded;
    } catch (error) {
      reportError(error);
    }
  }

  async function loadRun(id: string): Promise<void> {
    try {
      const detail = await commands.workflows.runGet(id);
      if (runId !== id) return;
      selected = detail;
    } catch (error) {
      reportError(error);
    }
  }

  // The URL owns the drill-down: workflow and run segments drive the loads.
  $effect(() => {
    const id = workflowId;
    openedArtifact = null;
    selected = null;
    if (!id) {
      runs = [];
      return;
    }
    void loadRuns(id);
  });

  $effect(() => {
    const id = runId;
    if (!id) {
      selected = null;
      return;
    }
    void loadRun(id);
  });

  $effect(() => {
    const artifactId = route.query.artifact ?? null;
    if (!artifactId) {
      openedArtifact = null;
      return;
    }
    if (!selected) return;
    openedArtifact = selected.artifacts.find((artifact) => artifact.id === artifactId) ?? null;
  });

  async function refresh(): Promise<void> {
    try {
      [contexts, workflows] = await Promise.all([
        commands.contexts.list(),
        commands.workflows.list(),
      ]);
      if (workflowId && !workflows.some((w) => w.id === workflowId)) {
        router.navigate(paths.workflows(undefined, undefined, workflowQuery()), { replace: true });
        return;
      }
      if (workflowId) await loadRuns(workflowId);
      if (runId) await loadRun(runId);
    } catch (error) {
      reportError(error);
    }
  }

  useRefresh(["workflow.", "job.", "artifact.", "context."], refresh);

  function openWorkflow(id: string): void {
    router.navigate(paths.workflows(id, undefined, workflowQuery()));
  }

  function selectContext(value: string): void {
    context = value;
    router.navigate(
      paths.workflows(workflowId, runId, {
        context: value === "all" ? undefined : value,
        artifact: route.query.artifact,
      }),
      { replace: true },
    );
  }

  async function runNow(id: string): Promise<void> {
    try {
      const result = await commands.workflows.run(
        id,
        {},
        contextFilter === "all" ? undefined : contextFilter,
      );
      // Jump straight to the fresh run so its activity can be watched live.
      router.navigate(paths.workflows(result.workflow, result.runId, workflowQuery()));
    } catch (error) {
      reportError(error);
    }
  }

  function openRun(id: string): void {
    if (runId === id) {
      router.navigate(paths.workflows(workflowId, undefined, workflowQuery()));
      return;
    }
    router.navigate(paths.workflows(workflowId, id, workflowQuery()));
  }

  function openArtifact(artifact: ArtifactInfo): void {
    router.navigate(
      paths.workflows(workflowId, runId, workflowQuery(artifact.id)),
    );
  }

  function closeArtifact(): void {
    router.navigate(paths.workflows(workflowId, runId, workflowQuery()), { replace: true });
  }

  async function deleteRun(withArtifacts: boolean): Promise<void> {
    if (!selected || deleting) return;
    const run = selected;
    deleting = true;
    try {
      await commands.workflows.removeRun(run.id, withArtifacts);
      confirmingDelete = false;
      router.navigate(paths.workflows(workflowId, undefined, workflowQuery()), { replace: true });
      reportSuccess(
        `Run ${run.id.slice(0, 8)} deleted${withArtifacts ? ` with ${run.artifacts.length} artifact(s)` : ""}`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
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
  <div class="filters">
    <Select
      label="Context"
      options={contextOptions}
      value={context}
      onchange={(event) => selectContext(event.currentTarget.value)}
    />
  </div>

  <DataList items={visibleWorkflows} empty="No workflows in this context.">
    {#snippet children(workflow)}
      <div class="entry" class:selected={workflowId === workflow.id}>
        <ListItem
          onclick={() => openWorkflow(workflow.id)}
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
        <div class="entry" class:selected={runId === run.id}>
          <ListItem
            onclick={() => openRun(run.id)}
            overline={triggerLabel(run)}
            headline={`${run.workflow} · ${run.contextId}`}
            supporting={`${formatDateTime(run.startedAt)} · ${durationLabel(run)}`}
          >
            {#snippet leading()}
              <RunStatusIcon status={run.status} />
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
      <RunStatusIcon status={selected.status} size={20} />
      <Chip variant="assist" icon={iconSchedule}>
        {formatRelativeTime(selected.startedAt)}
      </Chip>
      <span class="danger">
        <Button
          variant="text"
          iconType="full"
          title="Delete run"
          onclick={() => (confirmingDelete = true)}
          disabled={deleting}
        >
          <Icon icon={iconDelete} />
        </Button>
      </span>
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
        <div class="entry" class:selected={openedArtifact?.id === artifact.id}>
          <ListItem
            onclick={() => openArtifact(artifact)}
            overline={artifact.kind}
            headline={artifact.name ?? artifact.id.slice(0, 8)}
            supporting={`${artifact.contentType} · ${formatDateTime(artifact.createdAt)}`}
          >
            {#snippet trailing()}
              <Icon icon={iconChevronRight} />
            {/snippet}
          </ListItem>
        </div>
      {/snippet}
    </DataList>
  {:else}
    <p class="muted">Select a run to see its activity, output and artifacts.</p>
  {/if}
</Pane>

<Dialog headline="Delete this run?" bind:open={confirmingDelete}>
  <p>
    Run {selected?.id.slice(0, 8)} ({selected?.workflow}) will be removed from the history.
    {#if (selected?.artifacts.length ?? 0) > 0}
      Delete the {selected?.artifacts.length} artifact(s) it produced as well? Artifacts that are
      kept stay available in the Artifacts tab.
    {:else}
      It produced no artifacts.
    {/if}
  </p>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (confirmingDelete = false)} disabled={deleting}>
      Cancel
    </Button>
    <span class="danger">
      <Button variant="text" onclick={() => deleteRun(false)} disabled={deleting}>
        Keep artifacts
      </Button>
    </span>
    <span class="danger">
      <Button variant="filled" onclick={() => deleteRun(true)} disabled={deleting}>
        Delete artifacts too
      </Button>
    </span>
  {/snippet}
</Dialog>

{#if openedArtifact}
  <ArtifactDrawer artifact={openedArtifact} onclose={closeArtifact} />
{/if}

<style>
  .subhead {
    margin: 1.25rem 0 0.5rem;
    padding-inline: 0.25rem;
  }

  .filters {
    padding: 0.25rem 0.25rem 0.6rem;
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
