<script lang="ts">
  import { VariableTabs } from "m3-svelte";
  import { commands } from "../lib/commands";
  import type {
    AppContextInfo,
    ArtifactInfo,
    DeliveryRecord,
    WorkflowInfo,
    WorkflowRunDetail,
    WorkflowRunInfo,
  } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import {
    WORKFLOW_TABS,
    isBriefingReset,
    isEditableWorkflow,
    workflowQuery,
  } from "../lib/workflows";
  import CreateWorkflowDialog from "./CreateWorkflowDialog.svelte";
  import DeleteRunDialog from "./DeleteRunDialog.svelte";
  import DeleteWorkflowDialog from "./DeleteWorkflowDialog.svelte";
  import RunDetailPane from "./RunDetailPane.svelte";
  import RunListPane from "./RunListPane.svelte";
  import WorkflowDetailsPane from "./WorkflowDetailsPane.svelte";
  import WorkflowListPane from "./WorkflowListPane.svelte";

  let contexts = $state<AppContextInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let runs = $state<WorkflowRunInfo[]>([]);
  let selected = $state<WorkflowRunDetail | null>(null);
  let deliveries = $state<DeliveryRecord[]>([]);

  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let cancelling = $state(false);

  let createOpen = $state(false);
  let confirmingDeleteWorkflow = $state(false);
  let deleteWorkflowTarget = $state<WorkflowInfo | null>(null);
  let deletingWorkflow = $state(false);

  /** Active tab right of the workflow list; a run in the URL opens on Runs. */
  let tab = $state(router.current.segments[1] ? "runs" : "details");

  // URL scheme: /workflows[/:workflowId[/:runId]] with ?context=.
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
  const selectedEditable = $derived(selectedWorkflow !== null && isEditableWorkflow(selectedWorkflow));
  const selectedResettable = $derived(selectedWorkflow !== null && isBriefingReset(selectedWorkflow));
  const selectedUser = $derived(selectedWorkflow !== null && selectedWorkflow.user === true);
  /** The briefing definition new workflows are created from. */
  const resettingBriefing = $derived(
    deleteWorkflowTarget !== null && isBriefingReset(deleteWorkflowTarget),
  );
  const query = $derived(workflowQuery(contextFilter));

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

  async function loadDeliveries(id: string): Promise<void> {
    try {
      const records = await commands.delivery.list({ runId: id });
      if (selected?.id !== id) return;
      deliveries = records;
    } catch (error) {
      reportError(error);
    }
  }

  // The URL owns the drill-down: workflow and run segments drive the loads.
  $effect(() => {
    const id = workflowId;
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

  // Delivery records for the open run, refreshed whenever the run detail changes.
  $effect(() => {
    const run = selected;
    if (!run) {
      deliveries = [];
      return;
    }
    void loadDeliveries(run.id);
  });

  async function refresh(): Promise<void> {
    try {
      [contexts, workflows] = await Promise.all([
        commands.contexts.list(),
        commands.workflows.list(),
      ]);
    } catch (error) {
      reportError(error);
      return;
    }
    try {
      if (workflowId && !workflows.some((w) => w.id === workflowId)) {
        router.navigate(paths.workflows(undefined, undefined, query), { replace: true });
        return;
      }
      if (workflowId) await loadRuns(workflowId);
      if (runId) {
        if (!runs.some((run) => run.id === runId)) {
          router.navigate(paths.workflows(workflowId, undefined, query), {
            replace: true,
          });
          return;
        }
        await loadRun(runId);
      }
    } catch (error) {
      reportError(error);
    }
  }

  useRefresh(["workflow.", "job.", "artifact.", "context.", "delivery."], refresh);

  function openWorkflow(id: string): void {
    router.navigate(paths.workflows(id, undefined, query));
  }

  function selectContext(value: string): void {
    context = value;
    router.navigate(
      paths.workflows(workflowId, runId, { context: value === "all" ? undefined : value }),
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
      tab = "runs";
      router.navigate(paths.workflows(result.workflow, result.runId, query));
    } catch (error) {
      reportError(error);
    }
  }

  function openRun(id: string): void {
    router.navigate(paths.workflows(workflowId, id, query));
  }

  // Artifacts open in the Artifacts tab, keeping run and artifact history linked.
  function openArtifact(artifact: ArtifactInfo): void {
    router.navigate(paths.artifacts(artifact.id, { q: route.query.q }));
  }

  async function deleteRun(withArtifacts: boolean): Promise<void> {
    if (!selected || deleting) return;
    const run = selected;
    deleting = true;
    try {
      await commands.workflows.removeRun(run.id, withArtifacts);
      confirmingDelete = false;
      router.navigate(paths.workflows(workflowId, undefined, query), { replace: true });
      reportSuccess(
        `Run ${run.id.slice(0, 8)} deleted${withArtifacts ? ` with ${run.artifacts.length} artifact(s)` : ""}`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }

  async function cancelRun(): Promise<void> {
    if (!selected || cancelling) return;
    cancelling = true;
    try {
      await commands.workflows.cancel(selected.id);
      reportSuccess("Run cancellation requested");
    } catch (error) {
      reportError(error);
    } finally {
      cancelling = false;
    }
  }

  function confirmDeleteSelectedWorkflow(): void {
    if (selectedWorkflow) confirmDeleteWorkflow(selectedWorkflow);
  }

  function confirmDeleteWorkflow(workflow: WorkflowInfo): void {
    deleteWorkflowTarget = workflow;
    confirmingDeleteWorkflow = true;
  }

  async function removeWorkflow(): Promise<void> {
    const target = deleteWorkflowTarget;
    if (!target || deletingWorkflow) return;
    const reset = isBriefingReset(target);
    deletingWorkflow = true;
    try {
      await commands.userWorkflows.remove(target.id);
      confirmingDeleteWorkflow = false;
      deleteWorkflowTarget = null;
      reportSuccess(reset ? "Workflow reset to defaults" : "Workflow deleted");
      if (!reset && workflowId === target.id) {
        router.navigate(paths.workflows(undefined, undefined, query), { replace: true });
      }
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      deletingWorkflow = false;
    }
  }

  function onWorkflowCreated(id: string): void {
    void refresh().then(() => {
      // Land on the new workflow so its step outputs can be assigned channels.
      router.navigate(paths.workflows(id, undefined, query));
    });
  }
</script>

<div class="view">
  <WorkflowListPane
    workflows={visibleWorkflows}
    {contextOptions}
    {context}
    selectedId={workflowId}
    oncreate={() => (createOpen = true)}
    oncontext={selectContext}
    onopen={openWorkflow}
    onrun={(id) => void runNow(id)}
  />

  <div class="content">
    <div class="tabbar">
      <VariableTabs bind:tab items={WORKFLOW_TABS} />
    </div>

    <div class="tabpage" class:active={tab === "runs"}>
      <div class="row">
        <RunListPane
          workflow={selectedWorkflow}
          {runs}
          selectedRunId={runId}
          onopen={openRun}
        />
        <RunDetailPane
          run={selected}
          {deliveries}
          {deleting}
          {cancelling}
          ondelete={() => (confirmingDelete = true)}
          oncancel={() => void cancelRun()}
          onopenartifact={openArtifact}
        />
      </div>
    </div>

    <div class="tabpage" class:active={tab === "details"}>
      <WorkflowDetailsPane
        workflow={selectedWorkflow}
        editable={selectedEditable}
        user={selectedUser}
        resettable={selectedResettable}
        deleting={deletingWorkflow}
        ondelete={confirmDeleteSelectedWorkflow}
        onchanged={refresh}
      />
    </div>
  </div>
</div>

<DeleteRunDialog
  bind:open={confirmingDelete}
  run={selected}
  busy={deleting}
  onconfirm={(withArtifacts) => void deleteRun(withArtifacts)}
/>

<CreateWorkflowDialog bind:open={createOpen} onsaved={onWorkflowCreated} />

<DeleteWorkflowDialog
  bind:open={confirmingDeleteWorkflow}
  workflow={deleteWorkflowTarget}
  resetting={resettingBriefing}
  busy={deletingWorkflow}
  onconfirm={() => void removeWorkflow()}
/>

<style>
  .view {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }

  /* Match the tab strip height to the pane headers so the top bars line up. */
  .tabbar {
    flex: none;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .tabbar :global(.divider) {
    display: none;
  }

  .tabbar :global(.m3-container),
  .tabbar :global(.primary > label.tall) {
    height: 3.5rem;
  }

  /* Both tab pages stay mounted (hidden rather than removed) so switching
     tabs keeps pane widths, scroll positions and loaded runs intact. */
  .tabpage {
    display: none;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .tabpage.active {
    display: flex;
  }

  .row {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }
</style>
