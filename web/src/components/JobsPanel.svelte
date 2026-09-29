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
  import Panel from "./Panel.svelte";

  interface Props {
    defaultCron?: string;
  }

  let { defaultCron = "0 7 * * *" }: Props = $props();

  let jobs = $state<ScheduledJob[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let busy = $state(false);

  let name = $state("morning-brief");
  let cron = $state("0 7 * * *");
  let workflow = $state("briefing");
  let voiceEnabled = $state(true);
  let defaultCronApplied = false;

  const workflowOptions = $derived(workflows.map((entry) => ({ text: entry.id, value: entry.id })));

  async function refresh(): Promise<void> {
    try {
      [jobs, workflows] = await Promise.all([commands.jobs.list(), commands.workflows.list()]);
      if (workflows.length > 0 && !workflows.some((entry) => entry.id === workflow)) {
        workflow = workflows[0]!.id;
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

  async function toggleVoice(job: ScheduledJob): Promise<void> {
    const generateAudio = job.input.generateAudio === false;
    try {
      await commands.jobs.update(job.id, { input: { ...job.input, generateAudio } });
    } catch (error) {
      reportError(error);
    }
  }

  async function run(id: string): Promise<void> {
    try {
      await commands.jobs.run(id);
    } catch (error) {
      reportError(error);
    }
  }

  async function toggle(job: ScheduledJob): Promise<void> {
    try {
      await commands.jobs.update(job.id, { enabled: !job.enabled });
    } catch (error) {
      reportError(error);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await commands.jobs.remove(id);
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

<Panel>
  <h2>Scheduled tasks</h2>

  <div class="actions">
    <TextFieldOutlined label="Name" bind:value={name} />
    <TextFieldOutlined label="Cron expression" bind:value={cron} enter={create} />
    <Select label="Workflow" options={workflowOptions} bind:value={workflow} />
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
      <span class="voice-label">Voice</span>
    </label>
    <Button variant="filled" iconType="left" onclick={create} disabled={busy}>
      <Icon icon={iconAdd} /> Add task
    </Button>
  </div>

  <DataList items={jobs} empty="No scheduled tasks.">
    {#snippet children(job)}
      <ListItem
        overline={job.enabled ? "enabled" : "disabled"}
        headline={job.name}
        supporting={supportingText(job)}
      >
        {#snippet leading()}
          <Icon icon={iconSchedule} />
        {/snippet}
          {#snippet trailing()}
            <div class="actions">
              <label
                class="voice-toggle"
                title={job.input.generateAudio === false
                  ? "Text only — switch on to include the voice message"
                  : "Voice + text — switch off for text-only delivery"}
              >
                <Switch
                  checked={job.input.generateAudio !== false}
                  icons="both"
                  checkedIcon={iconMic}
                  uncheckedIcon={iconMicOff}
                  onchange={() => toggleVoice(job)}
                />
              </label>
              <Button variant="tonal" iconType="left" onclick={() => run(job.id)}>
                <Icon icon={iconPlay} /> Run
              </Button>
              <Button variant="text" onclick={() => toggle(job)}>
                {job.enabled ? "Disable" : "Enable"}
              </Button>
              <Button variant="text" iconType="full" onclick={() => remove(job.id)}>
                <Icon icon={iconDelete} />
              </Button>
            </div>
          {/snippet}
      </ListItem>
    {/snippet}
  </DataList>
</Panel>

<style>
  .voice-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .voice-label {
    line-height: 1;
  }
</style>

