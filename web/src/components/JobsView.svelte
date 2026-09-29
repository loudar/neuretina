<script lang="ts">
  import { Button, Icon, ListItem, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconMic from "@ktibow/iconset-material-symbols/mic";
  import iconMicOff from "@ktibow/iconset-material-symbols/mic-off";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import { commands, type ScheduledJob, type WorkflowInfo } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import { formatDateTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";

  interface Props {
    defaultCron?: string;
  }

  let { defaultCron = "0 7 * * *" }: Props = $props();

  let jobs = $state<ScheduledJob[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let selectedId = $state<string | null>(null);
  let busy = $state(false);
  let saving = $state(false);
  let running = $state(false);

  let name = $state("morning-brief");
  let cron = $state("0 7 * * *");
  let workflow = $state("briefing");
  let voiceEnabled = $state(true);
  let defaultCronApplied = false;

  let editName = $state("");
  let editCron = $state("");

  const selected = $derived(jobs.find((job) => job.id === selectedId) ?? null);
  const workflowOptions = $derived(workflows.map((entry) => ({ text: entry.id, value: entry.id })));

  async function refresh(): Promise<void> {
    try {
      [jobs, workflows] = await Promise.all([commands.jobs.list(), commands.workflows.list()]);
      if (workflows.length > 0 && !workflows.some((entry) => entry.id === workflow)) {
        workflow = workflows[0]!.id;
      }
      if (selectedId && !jobs.some((job) => job.id === selectedId)) {
        selectedId = null;
      }
    } catch (error) {
      reportError(error);
    }
  }

  useRefresh(["job."], refresh);

  $effect(() => {
    if (!defaultCronApplied && defaultCron) {
      cron = defaultCron;
      defaultCronApplied = true;
    }
  });

  async function create(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      await commands.jobs.create({
        name: name.trim(),
        cron: cron.trim(),
        workflow,
        input: { generateAudio: voiceEnabled },
      });
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  }

  function select(job: ScheduledJob): void {
    selectedId = job.id;
    editName = job.name;
    editCron = job.cron;
  }

  async function save(): Promise<void> {
    if (!selected || saving) return;
    saving = true;
    try {
      await commands.jobs.update(selected.id, { name: editName.trim(), cron: editCron.trim() });
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }

  async function toggleVoice(): Promise<void> {
    if (!selected) return;
    const generateAudio = selected.input.generateAudio === false;
    try {
      await commands.jobs.update(selected.id, { input: { ...selected.input, generateAudio } });
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleEnabled(): Promise<void> {
    if (!selected) return;
    try {
      await commands.jobs.update(selected.id, { enabled: !selected.enabled });
    } catch (error) {
      reportError(error);
    }
  }

  async function run(): Promise<void> {
    if (!selected || running) return;
    running = true;
    try {
      await commands.jobs.run(selected.id);
    } catch (error) {
      reportError(error);
    } finally {
      running = false;
    }
  }

  async function remove(): Promise<void> {
    if (!selected) return;
    const target = selected;
    try {
      selectedId = null;
      await commands.jobs.remove(target.id);
    } catch (error) {
      reportError(error);
    }
  }

  function supportingText(job: ScheduledJob): string {
    const status = job.lastStatus ? ` (${job.lastStatus})` : "";
    const mode = job.input.generateAudio === false ? "text only" : "voice + text";
    return `${job.workflow} · ${mode} · cron ${job.cron} · last run ${formatDateTime(job.lastRunAt, "never")}${status}`;
  }
</script>

<Pane variant="list" title="Scheduled tasks">
  <div class="add-form">
    <TextFieldOutlined label="Name" bind:value={name} />
    <TextFieldOutlined label="Cron expression" bind:value={cron} enter={create} />
    <Select label="Workflow" options={workflowOptions} bind:value={workflow} />
    <div class="add-row">
      <label
        class="voice-toggle"
        title={voiceEnabled
          ? "Voice + text — switch off for text-only delivery"
          : "Text only — switch on to include the voice message"}
      >
        <Switch
          bind:checked={voiceEnabled}
          icons="both"
          checkedIcon={iconMic}
          uncheckedIcon={iconMicOff}
        />
        <span class="toggle-label">Voice</span>
      </label>
      <Button variant="filled" iconType="left" onclick={create} disabled={busy}>
        <Icon icon={iconAdd} /> Add task
      </Button>
    </div>
  </div>

  <DataList items={jobs} empty="No scheduled tasks.">
    {#snippet children(job)}
      <div class="entry" class:selected={selectedId === job.id} class:disabled={!job.enabled}>
        <ListItem
          onclick={() => select(job)}
          overline={job.enabled ? "enabled" : "disabled"}
          headline={job.name}
          supporting={supportingText(job)}
        >
          {#snippet leading()}
            <Icon icon={iconSchedule} />
          {/snippet}
        </ListItem>
      </div>
    {/snippet}
  </DataList>
</Pane>

<Pane
  variant="detail"
  title={selected?.name ?? "Task details"}
  subtitle={selected ? `workflow ${selected.workflow} · id ${selected.id.slice(0, 8)}` : undefined}
>
  {#snippet actions()}
    {#if selected}
      <label
        class="voice-toggle"
        title={selected.input.generateAudio === false
          ? "Text only — switch on to include the voice message"
          : "Voice + text — switch off for text-only delivery"}
      >
        <Switch
          checked={selected.input.generateAudio !== false}
          icons="both"
          checkedIcon={iconMic}
          uncheckedIcon={iconMicOff}
          onchange={toggleVoice}
        />
      </label>
      <Button variant="tonal" iconType="left" onclick={run} disabled={running}>
        <Icon icon={iconPlay} /> Run now
      </Button>
      <Button variant="text" iconType="full" onclick={remove}>
        <Icon icon={iconDelete} />
      </Button>
    {/if}
  {/snippet}

  {#if selected}
    <div class="detail-form">
      <TextFieldOutlined label="Name" bind:value={editName} enter={save} />
      <TextFieldOutlined label="Cron expression" bind:value={editCron} enter={save} />
      <div class="actions">
        <Button variant="filled" onclick={save} disabled={saving}>Save changes</Button>
      </div>
    </div>

    <div class="facts">
      <div class="fact">
        <span class="label">Workflow</span>
        <span>{selected.workflow}</span>
      </div>
      <div class="fact">
        <span class="label">State</span>
        <label class="inline-toggle">
          <Switch checked={selected.enabled} onchange={toggleEnabled} />
          <span>{selected.enabled ? "enabled" : "disabled"}</span>
        </label>
      </div>
      <div class="fact">
        <span class="label">Last run</span>
        <span>{formatDateTime(selected.lastRunAt, "never")}{selected.lastStatus
            ? ` (${selected.lastStatus})`
            : ""}</span>
      </div>
      <div class="fact">
        <span class="label">Delivery</span>
        <span>{selected.input.generateAudio === false ? "text only" : "voice + text"}</span>
      </div>
    </div>
  {:else}
    <p class="muted">Select a task to edit it, run it, or add a new one on the left.</p>
  {/if}
</Pane>

<style>
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.25rem 0.25rem 0.75rem;
    border-bottom: 1px solid var(--m3c-outline-variant);
    margin-bottom: 0.5rem;
  }

  .add-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .voice-toggle,
  .inline-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .toggle-label {
    line-height: 1;
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

  .entry.disabled {
    opacity: 0.65;
  }

  .detail-form {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    max-width: 36rem;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1.25rem;
    max-width: 36rem;
  }

  .fact {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.9rem;
  }

  .fact .label {
    min-width: 5.5rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.8rem;
  }
</style>
