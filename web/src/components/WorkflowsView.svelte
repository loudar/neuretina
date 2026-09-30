<script lang="ts">
  import { Button, Chip, Dialog, Icon, ListItem, Select, VariableTabs } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconChevronRight from "@ktibow/iconset-material-symbols/chevron-right";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconHistory from "@ktibow/iconset-material-symbols/history";
  import iconInfo from "@ktibow/iconset-material-symbols/info";
  import iconPayments from "@ktibow/iconset-material-symbols/payments";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import {
    commands,
    type AppContextInfo,
    type ArtifactInfo,
    type DeliveryChannelInfo,
    type DeliveryRecord,
    type DeliveryWorkflowInfo,
    type Topic,
    type WorkflowInfo,
    type WorkflowRunDetail,
    type WorkflowRunInfo,
  } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime, formatRelativeTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";
  import RunStatusIcon from "./RunStatusIcon.svelte";
  import StatusFeedPanel from "./StatusFeed.svelte";
  import WorkflowForm from "./WorkflowForm.svelte";
  import WorkflowSteps from "./WorkflowSteps.svelte";

  let contexts = $state<AppContextInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let deliveryWorkflows = $state<DeliveryWorkflowInfo[]>([]);
  let runs = $state<WorkflowRunInfo[]>([]);
  let selected = $state<WorkflowRunDetail | null>(null);
  let deliveries = $state<DeliveryRecord[]>([]);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let cancelling = $state(false);

  let topics = $state<Topic[]>([]);
  let channels = $state<DeliveryChannelInfo[]>([]);

  /** Active tab right of the workflow list; a run in the URL opens on Runs. */
  let tab = $state(router.current.segments[1] ? "runs" : "details");

  // Details tab editor. `editorId` records which workflow the fields hold;
  // the *Base* snapshots are the saved values the dirty check compares against.
  let editorId = $state<string | null>(null);
  let editorName = $state("");
  /** Configured input values keyed by input id, e.g. `{ topics: ["…"] }`. */
  let editorInputs = $state<Record<string, string[]>>({});
  /** Assigned channel ids keyed by "step/output". */
  let editorAssignments = $state<Record<string, string[]>>({});
  let editorBaseName = $state("");
  let editorBaseInputs = $state("");
  let editorBaseAssignments = $state("");
  let editorLoading = $state(false);
  let savingWorkflow = $state(false);

  // New-workflow dialog state; kept apart so it cannot clobber the editor.
  let createOpen = $state(false);
  let newName = $state("");
  let newInputs = $state<Record<string, string[]>>({});

  let confirmingDeleteWorkflow = $state(false);
  let deleteWorkflowTarget = $state<WorkflowInfo | null>(null);
  let deletingWorkflow = $state(false);

  const TAB_ITEMS = [
    { name: "Details", value: "details", icon: iconInfo },
    { name: "Runs", value: "runs", icon: iconHistory },
  ];

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

  const selectedEditable = $derived(selectedWorkflow !== null && isEditable(selectedWorkflow));

  const selectedResettable = $derived(
    selectedWorkflow !== null && isBriefingReset(selectedWorkflow),
  );

  const selectedUser = $derived(selectedWorkflow !== null && selectedWorkflow.user === true);

  const attachments = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const entry of deliveryWorkflows) map.set(entry.workflow, entry.channelIds);
    return map;
  });

  const editorReady = $derived(
    selectedWorkflow !== null && editorId === selectedWorkflow.id && !editorLoading,
  );

  const editorDirty = $derived(
    editorReady &&
      (editorName.trim() !== editorBaseName ||
        serializeInputs(editorInputs) !== editorBaseInputs ||
        serializeAssignments(editorAssignments) !== editorBaseAssignments),
  );

  /** Every required input holds a value (e.g. at least one topic). */
  const editorInputsValid = $derived(
    (selectedWorkflow?.inputs ?? []).every(
      (spec) => !spec.required || (editorInputs[spec.id]?.length ?? 0) > 0,
    ),
  );

  const canSaveWorkflow = $derived(
    editorReady && editorDirty && !savingWorkflow && editorName.trim() !== "" && editorInputsValid,
  );

  /** The briefing definition new workflows are created from. */
  const createTemplate = $derived(
    workflows.find((workflow) => workflow.id === "briefing") ?? workflows[0],
  );

  const canCreateWorkflow = $derived(
    !savingWorkflow &&
      newName.trim() !== "" &&
      (createTemplate?.inputs ?? []).every(
        (spec) => !spec.required || (newInputs[spec.id]?.length ?? 0) > 0,
      ),
  );

  const resettingBriefing = $derived(
    deleteWorkflowTarget !== null && isBriefingReset(deleteWorkflowTarget),
  );

  /** Query for the current view state. */
  function workflowQuery(): { context?: string } {
    return { context: contextFilter === "all" ? undefined : contextFilter };
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

  async function loadDeliveries(id: string): Promise<void> {
    try {
      const records = await commands.delivery.list({ runId: id });
      if (selected?.id !== id) return;
      deliveries = records;
    } catch (error) {
      reportError(error);
    }
  }

  /** Channel ids assigned to a workflow's step outputs, keyed "step/output". */
  async function loadAssignments(id: string): Promise<Record<string, string[]>> {
    const attachments = await commands.delivery.attachments();
    const assignments: Record<string, string[]> = {};
    for (const attachment of attachments) {
      if (attachment.workflow !== id) continue;
      const key = assignmentKey(attachment.step, attachment.output);
      (assignments[key] ??= []).push(attachment.channelId);
    }
    return assignments;
  }

  // Seeds the details editor with the workflow's saved settings.
  async function loadEditor(workflow: WorkflowInfo): Promise<void> {
    const id = workflow.id;
    editorId = id;
    editorLoading = true;
    try {
      const [loadedTopics, loadedChannels, assignments] = await Promise.all([
        commands.topics.list(),
        commands.delivery.channels(),
        loadAssignments(id),
      ]);
      if (workflowId !== id) return;
      topics = loadedTopics;
      channels = loadedChannels;

      const inputs: Record<string, string[]> = {};
      for (const spec of workflow.inputs) {
        if (spec.kind !== "topics") continue;
        const stored = workflow.inputValues?.[spec.id];
        if (Array.isArray(stored)) {
          inputs[spec.id] = stored.filter((value): value is string => typeof value === "string");
        } else {
          // The un-customized briefing covers all topics until pinned.
          inputs[spec.id] = id === "briefing" ? loadedTopics.map((topic) => topic.id) : [];
        }
      }

      editorName = workflow.user ? workflow.title : id;
      editorInputs = inputs;
      editorAssignments = assignments;
      editorBaseName = editorName;
      editorBaseInputs = serializeInputs(inputs);
      editorBaseAssignments = serializeAssignments(assignments);
    } catch (error) {
      reportError(error);
    } finally {
      if (editorId === id) editorLoading = false;
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

  // Seed the editor when a different workflow is selected; a background
  // refresh of the list must not clobber unsaved edits.
  $effect(() => {
    const workflow = selectedWorkflow;
    if (!workflow) {
      editorId = null;
      return;
    }
    if (editorId === workflow.id) return;
    void loadEditor(workflow);
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
    // The delivery backend may still be coming up; its failure must not stop
    // the rest of the tab.
    try {
      deliveryWorkflows = await commands.delivery.workflows();
    } catch (error) {
      reportError(error);
    }
    try {
      if (workflowId && !workflows.some((w) => w.id === workflowId)) {
        router.navigate(paths.workflows(undefined, undefined, workflowQuery()), { replace: true });
        return;
      }
      if (workflowId) await loadRuns(workflowId);
      if (runId) {
        if (!runs.some((run) => run.id === runId)) {
          router.navigate(paths.workflows(workflowId, undefined, workflowQuery()), {
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
    router.navigate(paths.workflows(id, undefined, workflowQuery()));
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
      router.navigate(paths.workflows(result.workflow, result.runId, workflowQuery()));
    } catch (error) {
      reportError(error);
    }
  }

  async function openCreate(): Promise<void> {
    newName = "";
    newInputs = {};
    try {
      topics = await commands.topics.list();
      createOpen = true;
    } catch (error) {
      reportError(error);
    }
  }

  function isEditable(workflow: WorkflowInfo): boolean {
    return workflow.user === true || workflow.id === "briefing";
  }

  function toggleAssignment(step: string, output: string, channelId: string): void {
    const key = assignmentKey(step, output);
    const current = editorAssignments[key] ?? [];
    editorAssignments = {
      ...editorAssignments,
      [key]: current.includes(channelId)
        ? current.filter((entry) => entry !== channelId)
        : [...current, channelId],
    };
  }

  // Attaches/detaches channels so each step output matches `assignments`.
  async function reconcileAssignments(
    id: string,
    assignments: Record<string, string[]>,
  ): Promise<void> {
    const current = await loadAssignments(id);
    const keys = new Set([...Object.keys(current), ...Object.keys(assignments)]);
    for (const key of keys) {
      const [step, output] = splitAssignmentKey(key);
      const target = { workflow: id, step, output };
      const wanted = assignments[key] ?? [];
      const existing = current[key] ?? [];
      for (const channelId of wanted) {
        if (!existing.includes(channelId)) await commands.delivery.attach(target, channelId);
      }
      for (const channelId of existing) {
        if (!wanted.includes(channelId)) await commands.delivery.detach(target, channelId);
      }
    }
  }

  async function createWorkflow(): Promise<void> {
    if (!canCreateWorkflow) return;
    savingWorkflow = true;
    try {
      const created = await commands.userWorkflows.create({
        name: newName.trim(),
        inputs: { ...newInputs },
      });
      reportSuccess("Workflow saved");
      createOpen = false;
      await refresh();
      // Land on the new workflow so its step outputs can be assigned channels.
      router.navigate(paths.workflows(created.id, undefined, workflowQuery()));
    } catch (error) {
      reportError(error);
    } finally {
      savingWorkflow = false;
    }
  }

  // Saves the details editor: the name/inputs row first (an upsert also
  // customizes a built-in workflow), then the step-output channel assignments.
  async function saveWorkflow(): Promise<void> {
    const id = editorId;
    const workflow = selectedWorkflow;
    if (!id || !workflow || !canSaveWorkflow) return;
    savingWorkflow = true;
    try {
      const name = editorName.trim();
      const inputs = { ...editorInputs };
      const nameChanged = name !== editorBaseName;
      const inputsChanged = serializeInputs(inputs) !== editorBaseInputs;
      if (workflow.user || nameChanged || inputsChanged) {
        await commands.userWorkflows.update(id, { name, inputs });
      }
      await reconcileAssignments(id, editorAssignments);
      editorBaseName = name;
      editorBaseInputs = serializeInputs(inputs);
      editorBaseAssignments = serializeAssignments(editorAssignments);
      reportSuccess("Workflow saved");
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      savingWorkflow = false;
    }
  }

  function isBriefingReset(workflow: WorkflowInfo): boolean {
    return workflow.id === "briefing" && workflow.user === true;
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
        router.navigate(paths.workflows(undefined, undefined, workflowQuery()), { replace: true });
      }
      await refresh();
      // Force the details editor to re-seed from the refreshed data.
      editorId = null;
    } catch (error) {
      reportError(error);
    } finally {
      deletingWorkflow = false;
    }
  }

  function openRun(id: string): void {
    if (runId === id) {
      router.navigate(paths.workflows(workflowId, undefined, workflowQuery()));
      return;
    }
    router.navigate(paths.workflows(workflowId, id, workflowQuery()));
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

  function workflowOverline(workflow: WorkflowInfo): string {
    return workflow.user ? "user workflow" : workflow.contextId ?? "default context";
  }

  function workflowHeadline(workflow: WorkflowInfo): string {
    return workflow.user ? workflow.title : workflow.id;
  }

  /** List supporting text; user workflows show no summary line. */
  function workflowSupporting(workflow: WorkflowInfo): string {
    if (!workflow.user) {
      return `${workflow.description} · triggers ${workflow.triggers.join(", ") || "none"}`;
    }
    return "";
  }

  /** Details header subtitle with the workflow's configured inputs. */
  function workflowSummary(workflow: WorkflowInfo): string {
    if (!workflow.user) return workflowSupporting(workflow);
    const topicIds = workflow.inputValues?.topics;
    const topicCount = Array.isArray(topicIds) ? topicIds.length : 0;
    const channelCount = attachments.get(workflow.id)?.length ?? 0;
    return `${topicCount} topic(s) · ${channelCount} channel(s)`;
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

  function formatUsd(value: number): string {
    return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
  }

  function costLabel(cost: { totalUsd: number; complete: boolean }): string {
    return formatUsd(cost.totalUsd);
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

  function assignmentKey(step: string, output: string): string {
    return `${step}/${output}`;
  }

  function splitAssignmentKey(key: string): [string, string] {
    const [step = "", output = ""] = key.split("/");
    return [step, output];
  }

  /** Order-insensitive snapshot of the input editor's values. */
  function serializeInputs(inputs: Record<string, string[]>): string {
    const entries = Object.entries(inputs)
      .map(([key, values]) => [key, [...values].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(entries));
  }

  /** Order-insensitive snapshot of the channel assignments (empty keys dropped). */
  function serializeAssignments(assignments: Record<string, string[]>): string {
    const entries = Object.entries(assignments)
      .filter(([, channelIds]) => channelIds.length > 0)
      .map(([key, channelIds]) => [key, [...channelIds].sort()] as const)
      .sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify(Object.fromEntries(entries));
  }
</script>

<div class="view">
  <Pane variant="list" title="Workflows">
    {#snippet actions()}
      <Button variant="tonal" iconType="left" title="New workflow" onclick={openCreate}>
        <Icon icon={iconAdd} /> New workflow
      </Button>
    {/snippet}

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
            overline={workflowOverline(workflow)}
            headline={workflowHeadline(workflow)}
            supporting={workflowSupporting(workflow)}
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

  <div class="content">
    <div class="tabbar">
      <VariableTabs bind:tab items={TAB_ITEMS} />
    </div>

    <div class="tabpage" class:active={tab === "runs"}>
      <div class="row">
        <Pane variant="list" title="Runs" subtitle={selectedWorkflow?.id}>
          {#if selectedWorkflow}
            <DataList items={runs} empty="No runs for this workflow yet.">
              {#snippet children(run)}
                <div class="entry" class:selected={runId === run.id}>
                  <ListItem
                    onclick={() => openRun(run.id)}
                    overline={triggerLabel(run)}
                    headline={`${run.workflow} · ${run.contextId}`}
                    supporting={`${formatDateTime(run.startedAt)} · ${durationLabel(run)}${run.cost ? ` · ${costLabel(run.cost)}` : ""}`}
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
              {#if selected.cost}
                <Chip variant="assist" icon={iconPayments}>{costLabel(selected.cost)}</Chip>
              {/if}
              {#if selected.status === "running"}
                <span class="danger">
                  <Button variant="tonal" iconType="left" onclick={cancelRun} disabled={cancelling}>
                    Cancel
                  </Button>
                </span>
              {/if}
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
                <div class="entry">
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

            {#if deliveries.length > 0}
              <h3 class="subhead">Deliveries</h3>
              <DataList items={deliveries} empty="">
                {#snippet children(record)}
                  <div class="delivery">
                    <span class="provider-tag delivery-status" data-status={record.status}>
                      {record.status}
                    </span>
                    <div class="delivery-info">
                      <span class="delivery-channel">{record.channelId}</span>
                      {#if record.error}
                        <span class="delivery-error">{record.error}</span>
                      {/if}
                    </div>
                    <span class="muted delivery-kind">{record.kind}</span>
                  </div>
                {/snippet}
              </DataList>
            {/if}
          {:else}
            <p class="muted">Select a run to see its activity, output and artifacts.</p>
          {/if}
        </Pane>
      </div>
    </div>

    <div class="tabpage" class:active={tab === "details"}>
      <Pane
        variant="detail"
        title={selectedWorkflow ? workflowHeadline(selectedWorkflow) : "Workflow details"}
        subtitle={selectedWorkflow ? workflowSummary(selectedWorkflow) : undefined}
      >
        {#snippet actions()}
          {#if selectedUser}
            <span class="danger">
              <Button
                variant="text"
                iconType="full"
                title={selectedResettable ? "Reset workflow" : "Delete workflow"}
                onclick={confirmDeleteSelectedWorkflow}
                disabled={deletingWorkflow}
              >
                <Icon icon={iconDelete} />
              </Button>
            </span>
          {/if}
        {/snippet}

        {#if !selectedWorkflow}
          <p class="muted">Select a workflow to see and edit its settings.</p>
        {:else if !editorReady}
          <p class="muted">Loading…</p>
        {:else}
          {#if selectedEditable}
            <div class="detail-form">
              <WorkflowForm
                bind:name={editorName}
                bind:inputs={editorInputs}
                specs={selectedWorkflow.inputs}
                {topics}
                disabled={savingWorkflow}
                capped={false}
                onenter={() => void saveWorkflow()}
              />
            </div>
          {:else}
            <div class="facts">
              <div class="fact">
                <span class="label">Description</span>
                <span>{selectedWorkflow.description}</span>
              </div>
              <div class="fact">
                <span class="label">Triggers</span>
                <span>{selectedWorkflow.triggers.join(", ") || "none"}</span>
              </div>
              <div class="fact">
                <span class="label">Context</span>
                <span>{selectedWorkflow.contextId ?? "default context"}</span>
              </div>
            </div>
            <p class="muted hint">This workflow is built in and has no editable settings.</p>
          {/if}

          <h3 class="subhead">Steps</h3>
          <WorkflowSteps
            steps={selectedWorkflow.steps}
            {channels}
            assignments={editorAssignments}
            editable={selectedEditable}
            ontoggle={toggleAssignment}
          />

          {#if selectedEditable}
            <div class="actions save-row">
              <Button
                variant="filled"
                onclick={() => void saveWorkflow()}
                disabled={!canSaveWorkflow}
              >
                Save changes
              </Button>
            </div>
          {/if}
        {/if}
      </Pane>
    </div>
  </div>
</div>

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

<Dialog headline="New workflow" bind:open={createOpen}>
  <div class="workflow-form">
    <WorkflowForm
      bind:name={newName}
      bind:inputs={newInputs}
      specs={createTemplate?.inputs ?? []}
      {topics}
      disabled={savingWorkflow}
      onenter={() => void createWorkflow()}
    />
  </div>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (createOpen = false)} disabled={savingWorkflow}>
      Cancel
    </Button>
    <Button variant="filled" onclick={() => void createWorkflow()} disabled={!canCreateWorkflow}>
      Save
    </Button>
  {/snippet}
</Dialog>

<Dialog
  headline={resettingBriefing ? "Reset this workflow?" : "Delete this workflow?"}
  bind:open={confirmingDeleteWorkflow}
>
  <p>
    {#if resettingBriefing}
      Reset "{deleteWorkflowTarget?.id}" to its defaults? The custom name and topic selection are
      removed; delivery channels and scheduled tasks are kept.
    {:else}
      "{deleteWorkflowTarget ? workflowHeadline(deleteWorkflowTarget) : ""}" will be permanently
      removed and its attached delivery channels are detached. Scheduled tasks that still use this
      workflow must be removed first. This cannot be undone.
    {/if}
  </p>
  {#snippet buttons()}
    <Button
      variant="text"
      onclick={() => (confirmingDeleteWorkflow = false)}
      disabled={deletingWorkflow}
    >
      Cancel
    </Button>
    <span class="danger">
      <Button variant="filled" onclick={() => void removeWorkflow()} disabled={deletingWorkflow}>
        {resettingBriefing ? "Reset" : "Delete"}
      </Button>
    </span>
  {/snippet}
</Dialog>

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

  .subhead {
    margin: 1.25rem 0 0.5rem;
    padding-inline: 0.25rem;
  }

  .filters {
    padding: 0.25rem 0.25rem 0.6rem;
  }

  .workflow-form {
    width: min(24rem, 100%);
  }

  .detail-form {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 36rem;
  }

  .save-row {
    margin-top: 1rem;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 36rem;
  }

  .fact {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 0.9rem;
  }

  .fact .label {
    min-width: 5.5rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.8rem;
  }

  .hint {
    margin-top: 1rem;
    max-width: 36rem;
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

  .delivery {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.55rem 0.25rem;
  }

  .delivery-info {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .delivery-channel {
    @apply --m3-body-medium;
    overflow-wrap: anywhere;
  }

  .delivery-error {
    @apply --m3-body-small;
    color: var(--m3c-on-surface-variant);
    overflow-wrap: anywhere;
  }

  .delivery-kind {
    @apply --m3-body-small;
    flex: none;
  }

  .delivery-status[data-status="sent"] {
    border-color: transparent;
    background-color: var(--m3c-success-container);
    color: var(--m3c-on-success-container);
  }

  .delivery-status[data-status="failed"] {
    border-color: transparent;
    background-color: var(--m3c-warning-container);
    color: var(--m3c-on-warning-container);
  }
</style>
