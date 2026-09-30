<script lang="ts">
  import { Button, Chip, Dialog, Icon, ListItem, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconChevronRight from "@ktibow/iconset-material-symbols/chevron-right";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconEdit from "@ktibow/iconset-material-symbols/edit";
  import iconPayments from "@ktibow/iconset-material-symbols/payments";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import {
    commands,
    type AppContextInfo,
    type ArtifactInfo,
    type DeliveryChannelInfo,
    type DeliveryChannelType,
    type DeliveryRecord,
    type DeliveryWorkflowInfo,
    type Topic,
    type UserWorkflowInfo,
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

  let contexts = $state<AppContextInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let userWorkflows = $state<UserWorkflowInfo[]>([]);
  let deliveryWorkflows = $state<DeliveryWorkflowInfo[]>([]);
  let runs = $state<WorkflowRunInfo[]>([]);
  let selected = $state<WorkflowRunDetail | null>(null);
  let deliveries = $state<DeliveryRecord[]>([]);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let cancelling = $state(false);

  let topics = $state<Topic[]>([]);
  let channels = $state<DeliveryChannelInfo[]>([]);
  let editorOpen = $state(false);
  let editingId = $state<string | null>(null);
  let editorName = $state("");
  let editorTopicIds = $state<string[]>([]);
  let editorChannelIds = $state<string[]>([]);
  let savingWorkflow = $state(false);
  let confirmingDeleteWorkflow = $state(false);
  let deleteWorkflowTarget = $state<WorkflowInfo | null>(null);
  let deletingWorkflow = $state(false);

  const TYPE_LABELS: Record<DeliveryChannelType, string> = {
    matrix: "Matrix",
    discord: "Discord",
    email: "Email",
  };

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

  const userWorkflowInfo = $derived.by(() => {
    const map = new Map<string, UserWorkflowInfo>();
    for (const entry of userWorkflows) map.set(entry.id, entry);
    return map;
  });

  const attachments = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const entry of deliveryWorkflows) map.set(entry.workflow, entry.channelIds);
    return map;
  });

  const canSaveWorkflow = $derived.by(() => {
    if (savingWorkflow || !editorName.trim()) return false;
    return editorTopicIds.length > 0;
  });

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
      [contexts, workflows, userWorkflows] = await Promise.all([
        commands.contexts.list(),
        commands.workflows.list(),
        commands.userWorkflows.list(),
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
      router.navigate(paths.workflows(result.workflow, result.runId, workflowQuery()));
    } catch (error) {
      reportError(error);
    }
  }

  async function openCreate(): Promise<void> {
    editingId = null;
    editorName = "";
    editorTopicIds = [];
    editorChannelIds = [];
    try {
      [topics, channels] = await Promise.all([
        commands.topics.list(),
        commands.delivery.channels(),
      ]);
      editorOpen = true;
    } catch (error) {
      reportError(error);
    }
  }

  async function openEdit(workflow: WorkflowInfo): Promise<void> {
    editingId = workflow.id;
    const info = userWorkflowInfo.get(workflow.id);
    editorName = info?.name ?? workflow.id;
    const presetTopicIds = info?.topicIds ?? workflow.topicIds;
    editorTopicIds = [...(presetTopicIds ?? [])];
    try {
      const [loadedTopics, loadedChannels, attached] = await Promise.all([
        commands.topics.list(),
        commands.delivery.channels(),
        commands.delivery.workflows(),
      ]);
      topics = loadedTopics;
      channels = loadedChannels;
      // The un-customized briefing covers all topics until a customization pins them.
      if (!presetTopicIds && workflow.id === "briefing") {
        editorTopicIds = loadedTopics.map((topic) => topic.id);
      }
      const channelIds = attached.find((entry) => entry.workflow === workflow.id)?.channelIds ?? [];
      editorChannelIds = [...channelIds];
      editorOpen = true;
    } catch (error) {
      reportError(error);
    }
  }

  function toggleTopic(id: string): void {
    editorTopicIds = editorTopicIds.includes(id)
      ? editorTopicIds.filter((entry) => entry !== id)
      : [...editorTopicIds, id];
  }

  function toggleChannel(id: string): void {
    editorChannelIds = editorChannelIds.includes(id)
      ? editorChannelIds.filter((entry) => entry !== id)
      : [...editorChannelIds, id];
  }

  function sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id) => b.includes(id));
  }

  // Saves the workflow first, then reconciles channel attachments against the
  // workflow's current attachments.
  async function saveWorkflow(): Promise<void> {
    if (!canSaveWorkflow) return;
    savingWorkflow = true;
    try {
      const name = editorName.trim();
      const topicIds = [...editorTopicIds];
      let id = editingId;
      if (id) {
        const info = userWorkflowInfo.get(id);
        const changed = !info || info.name !== name || !sameIds(info.topicIds, topicIds);
        // The briefing customization is an idempotent upsert, so push it even when nothing changed.
        if (id === "briefing" || changed) await commands.userWorkflows.update(id, { name, topicIds });
      } else {
        const created = await commands.userWorkflows.create({ name, topicIds });
        id = created.id;
      }
      const attached = await commands.delivery.workflows();
      const current = attached.find((entry) => entry.workflow === id)?.channelIds ?? [];
      for (const channelId of editorChannelIds) {
        if (!current.includes(channelId)) await commands.delivery.attach(id, channelId);
      }
      for (const channelId of current) {
        if (!editorChannelIds.includes(channelId)) await commands.delivery.detach(id, channelId);
      }
      reportSuccess("Workflow saved");
      editorOpen = false;
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
    return workflow.user ? userWorkflowInfo.get(workflow.id)?.name ?? workflow.id : workflow.id;
  }

  function workflowSupporting(workflow: WorkflowInfo): string {
    if (!workflow.user) {
      return `${workflow.description} · triggers ${workflow.triggers.join(", ") || "none"}`;
    }
    const topicCount =
      userWorkflowInfo.get(workflow.id)?.topicIds.length ?? workflow.topicIds?.length ?? 0;
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
</script>

<Pane variant="list" width="19rem" title="Workflows" storageKey="workflows">
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
            {#if workflow.user || workflow.id === "briefing"}
              <Button
                variant="text"
                iconType="full"
                title="Edit workflow"
                onclick={(event) => {
                  event.stopPropagation();
                  void openEdit(workflow);
                }}
              >
                <Icon icon={iconEdit} />
              </Button>
              {#if workflow.id === "briefing" && workflow.user}
                <span class="danger">
                  <Button
                    variant="text"
                    iconType="full"
                    title="Reset workflow"
                    onclick={(event) => {
                      event.stopPropagation();
                      confirmDeleteWorkflow(workflow);
                    }}
                  >
                    <Icon icon={iconDelete} />
                  </Button>
                </span>
              {:else if workflow.id !== "briefing"}
                <span class="danger">
                  <Button
                    variant="text"
                    iconType="full"
                    title="Delete workflow"
                    onclick={(event) => {
                      event.stopPropagation();
                      confirmDeleteWorkflow(workflow);
                    }}
                  >
                    <Icon icon={iconDelete} />
                  </Button>
                </span>
              {/if}
            {/if}
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

<Pane variant="list" width="21rem" title="Runs" subtitle={selectedWorkflow?.id} storageKey="workflows-runs">
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

<Dialog headline={editingId ? "Edit workflow" : "New workflow"} bind:open={editorOpen}>
  <div class="workflow-form">
    <TextFieldOutlined
      label="Name"
      bind:value={editorName}
      enter={() => void saveWorkflow()}
    />
    <div class="field-group">
      <h3 class="group-label">Topics</h3>
      {#if topics.length === 0}
        <p class="muted">No topics yet. Create topics first, then pick the ones to cover.</p>
      {:else}
        <div class="toggle-list">
          {#each topics as topic (topic.id)}
            <label class="toggle-row" class:muted={topic.muted}>
              <Switch
                checked={editorTopicIds.includes(topic.id)}
                disabled={savingWorkflow}
                onchange={() => toggleTopic(topic.id)}
              />
              <span>{topic.name}{topic.muted ? " (muted)" : ""}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
    <div class="field-group">
      <h3 class="group-label">Delivery channels</h3>
      {#if channels.length === 0}
        <p class="muted">No delivery channels yet.</p>
      {:else}
        <div class="toggle-list">
          {#each channels as channel (channel.id)}
            <label class="toggle-row">
              <Switch
                checked={editorChannelIds.includes(channel.id)}
                disabled={savingWorkflow}
                onchange={() => toggleChannel(channel.id)}
              />
              <span>{channel.name}</span>
              <span class="provider-tag">{TYPE_LABELS[channel.type]}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  </div>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (editorOpen = false)} disabled={savingWorkflow}>
      Cancel
    </Button>
    <Button variant="filled" onclick={() => void saveWorkflow()} disabled={!canSaveWorkflow}>
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
  .subhead {
    margin: 1.25rem 0 0.5rem;
    padding-inline: 0.25rem;
  }

  .filters {
    padding: 0.25rem 0.25rem 0.6rem;
  }

  .workflow-form {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    width: min(24rem, 100%);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .group-label {
    @apply --m3-title-small;
    color: var(--m3c-on-surface-variant);
  }

  .toggle-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    max-height: 12rem;
    overflow-y: auto;
    padding: 0.1rem;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .toggle-row.muted {
    opacity: 0.65;
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
