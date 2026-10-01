<script lang="ts">
  import { Button, Dialog, Icon, Switch } from "m3-svelte";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconLink from "@ktibow/iconset-material-symbols/link";
  import iconMic from "@ktibow/iconset-material-symbols/mic";
  import iconMicOff from "@ktibow/iconset-material-symbols/mic-off";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSend from "@ktibow/iconset-material-symbols/send";
  import { commands, type Brief, type DeliveryChannelInfo } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime, formatListDate, formatRelativeTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import DataList from "./DataList.svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import Pane from "./Pane.svelte";

  let briefs = $state<Brief[]>([]);
  let selected = $state<Brief | null>(null);
  let audioUrl = $state<string | null>(null);
  let timelineMarkdown = $state<string | null>(null);
  let busy = $state(false);
  let resending = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let generating = $state(false);
  let voiceEnabled = $state(true);

  let resendOpen = $state(false);
  let resendChannels = $state<DeliveryChannelInfo[]>([]);
  let resendSelected = $state<string[]>([]);
  let resendLoading = $state(false);

  const route = $derived(router.current);
  const briefId = $derived(route.segments[0] ?? null);

  // The source filter lives in `?source=`; typing rewrites the current
  // history entry so back/forward are not flooded with filter states.
  let sourceFilter = $state(route.query.source ?? "");
  $effect(() => {
    const query = route.query.source ?? "";
    if (query !== sourceFilter) sourceFilter = query;
  });

  function setSourceFilter(value: string): void {
    sourceFilter = value;
    router.navigate(paths.briefs(briefId, { source: value.trim() || undefined }), { replace: true });
  }

  async function refreshList(): Promise<void> {
    try {
      briefs = await commands.briefs.list();
    } catch (error) {
      reportError(error);
    }
  }

  async function loadBrief(id: string): Promise<void> {
    try {
      const brief = await commands.briefs.get(id);
      if (briefId !== id) return;
      selected = brief;
      audioUrl = null;
      timelineMarkdown = null;

      const [audio, timeline] = await Promise.all([
        brief.hasAudio ? commands.briefs.audio(id) : Promise.resolve(null),
        brief.timelineArtifactId
          ? commands.artifacts.content(brief.timelineArtifactId)
          : Promise.resolve(null),
      ]);
      if (briefId !== id) return;
      audioUrl = audio?.dataUrl ?? null;
      timelineMarkdown = timeline?.content ?? null;
    } catch (error) {
      reportError(error);
    }
  }

  // The URL owns the selection: /briefs/<id> loads the brief, /briefs clears it.
  $effect(() => {
    const id = briefId;
    if (!id) {
      selected = null;
      audioUrl = null;
      return;
    }
    void loadBrief(id);
  });

  async function runNow(): Promise<void> {
    busy = true;
    try {
      const run = await commands.workflows.run("briefing", { generateAudio: voiceEnabled });
      // Jump to the fresh run so its activity can be watched live.
      router.navigate(paths.workflows(run.workflow, run.runId));
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  }

  // Re-send targets the channels currently attached to the brief's workflow;
  // the dialog picks a subset of them per send.
  async function openResend(): Promise<void> {
    const brief = selected;
    if (!brief) return;
    resendOpen = true;
    resendChannels = [];
    resendSelected = [];
    resendLoading = true;
    try {
      const [channels, deliveryWorkflows] = await Promise.all([
        commands.delivery.channels(),
        commands.delivery.workflows(),
      ]);
      const attached = deliveryWorkflows.find((entry) => entry.workflow === brief.workflow);
      const attachedChannels = attached
        ? channels.filter((channel) => attached.channelIds.includes(channel.id))
        : [];
      resendChannels = attachedChannels;
      resendSelected = attachedChannels.slice(0, 1).map((channel) => channel.id);
    } catch (error) {
      reportError(error);
    } finally {
      resendLoading = false;
    }
  }

  function toggleResendChannel(id: string): void {
    resendSelected = resendSelected.includes(id)
      ? resendSelected.filter((entry) => entry !== id)
      : [...resendSelected, id];
  }

  async function resend(): Promise<void> {
    if (!selected || resending || resendSelected.length === 0) return;
    resending = true;
    try {
      const result = await commands.briefs.send(selected.id, resendSelected);
      const sent = result.results.filter((entry) => entry.status === "sent").length;
      const failed = result.results.length - sent;
      if (sent === 0) {
        reportError(`Brief delivery failed on all ${failed} channel(s)`);
      } else {
        reportSuccess(`Brief sent to ${sent} channel(s)${failed > 0 ? `, ${failed} failed` : ""}`);
      }
      resendOpen = false;
    } catch (error) {
      reportError(error);
    } finally {
      resending = false;
    }
  }

  async function generateVoice(): Promise<void> {
    if (!selected || generating) return;
    generating = true;
    try {
      const result = await commands.briefs.generateAudio(selected.id);
      reportSuccess(
        `Voice generated (${Math.round(result.bytes / 1024)} KB) and sent to Matrix`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      generating = false;
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selected || deleting) return;
    const target = selected;
    deleting = true;
    router.navigate(paths.briefs());
    try {
      await commands.briefs.remove(target.id);
      confirmingDelete = false;
      reportSuccess("Brief deleted");
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }

  useRefresh(
    ["brief.generated", "tts.synthesized", "message.voice.sent", "brief.deleted", "artifact.deleted"],
    async () => {
      await refreshList();
      if (!briefId) return;
      // The open brief may have been deleted (here or elsewhere).
      if (!briefs.some((brief) => brief.id === briefId)) {
        router.navigate(paths.briefs(), { replace: true });
        return;
      }
      await loadBrief(briefId);
    },
  );
</script>

<Pane variant="list" title="Briefs">
  {#snippet actions()}
    <label
      class="inline-toggle voice-toggle"
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
    </label>
    <Button variant="tonal" iconType="left" onclick={runNow} disabled={busy}>
      <Icon icon={iconPlay} /> Run now
    </Button>
  {/snippet}

  <DataList items={briefs} empty="No briefs yet. Run one now or wait for the scheduled task.">
    {#snippet children(brief)}
      <div class="entry" class:selected={selected?.id === brief.id}>
        <button type="button" class="brief-row" onclick={() => router.navigate(paths.briefs(brief.id))}>
          <span class="brief-date">{formatListDate(brief.createdAt)}</span>
          <span class="badges">
            <span class="badge topics" title={`${brief.topics.length} topic(s)`}>
              <Icon icon={iconLabel} size={14} />{brief.topics.length}
            </span>
            <span class="badge sources" title={`${brief.sources.length} source(s)`}>
              <Icon icon={iconLink} size={14} />{brief.sources.length}
            </span>
            <span
              class="badge audio"
              class:has-audio={brief.hasAudio}
              title={brief.hasAudio ? "Voice message available" : "Text only — no audio"}
            >
              <Icon icon={brief.hasAudio ? iconMic : iconMicOff} size={14} />{brief.hasAudio
                ? "audio"
                : "text"}
            </span>
          </span>
        </button>
      </div>
    {/snippet}
  </DataList>
</Pane>

<Pane
  variant="detail"
  title={selected ? selected.topics.join(", ") || "Untitled brief" : "Brief details"}
  subtitle={selected
    ? `${formatRelativeTime(selected.createdAt)}${selected.audioDurationMs
        ? ` · ${Math.round(selected.audioDurationMs / 1000)}s audio`
        : ""}`
    : undefined}
>
  {#snippet actions()}
    {#if selected}
      {#if !selected.hasAudio}
        <Button variant="tonal" iconType="left" onclick={generateVoice} disabled={generating}>
          <Icon icon={iconMic} /> {generating ? "Generating…" : "Generate voice"}
        </Button>
      {/if}
      <Button variant="tonal" iconType="left" onclick={() => void openResend()} disabled={resending}>
        <Icon icon={iconSend} /> Re-send
      </Button>
      <span class="danger">
        <Button
          variant="text"
          iconType="full"
          onclick={() => (confirmingDelete = true)}
          disabled={deleting}
        >
          <Icon icon={iconDelete} />
        </Button>
      </span>
    {/if}
  {/snippet}

  {#if selected}
    <div class="brief-body">
      {#if timelineMarkdown !== null}
        <div class="timeline">
          <MarkdownView markdown={timelineMarkdown} controls={false} />
        </div>
      {/if}

      {#if audioUrl}
        <audio controls src={audioUrl}></audio>
      {:else if selected.hasAudio}
        <p class="muted">Loading audio…</p>
      {/if}

      <MarkdownView
        markdown={selected.markdown}
        sources={selected.sources}
        filter={sourceFilter}
        onfilter={setSourceFilter}
      />
    </div>
  {:else}
    <p class="muted">Select a brief to read it and play the audio.</p>
  {/if}

  <Dialog headline="Re-send this brief?" bind:open={resendOpen}>
    <p>
      Deliver "{selected?.topics.join(", ") || "Untitled brief"}" to the selected delivery
      channels.
    </p>
    {#if resendLoading}
      <p class="muted">Loading channels…</p>
    {:else if resendChannels.length === 0}
      <p class="muted">No delivery channels attached to this workflow.</p>
    {:else}
      <div class="resend-channels">
        {#each resendChannels as channel (channel.id)}
          <label
            class="resend-channel"
            title={channel.enabled ? "" : "This channel is disabled"}
          >
            <Switch
              checked={resendSelected.includes(channel.id)}
              onchange={() => toggleResendChannel(channel.id)}
            />
            <span>{channel.name}{channel.enabled ? "" : " (disabled)"}</span>
            <span class="provider-tag" data-provider={channel.type}>{channel.type}</span>
          </label>
        {/each}
      </div>
    {/if}
    {#snippet buttons()}
      <Button variant="text" onclick={() => (resendOpen = false)} disabled={resending}>
        Cancel
      </Button>
      <Button
        variant="filled"
        onclick={() => void resend()}
        disabled={resending || resendSelected.length === 0}
      >
        {resending ? "Sending…" : "Send"}
      </Button>
    {/snippet}
  </Dialog>

  <Dialog headline="Delete this brief?" bind:open={confirmingDelete}>
    <p>
      "{selected?.topics.join(", ") || "Untitled brief"}" from
      {formatDateTime(selected?.createdAt)} will be permanently removed, including its audio. This
      cannot be undone.
    </p>
    {#snippet buttons()}
      <Button variant="text" onclick={() => (confirmingDelete = false)} disabled={deleting}>
        Cancel
      </Button>
      <span class="danger">
        <Button variant="filled" onclick={deleteSelected} disabled={deleting}>Delete</Button>
      </span>
    {/snippet}
  </Dialog>
</Pane>

<style>
  audio {
    width: 100%;
    margin-bottom: 0.75rem;
  }

  .resend-channels {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .resend-channel {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    user-select: none;
  }

  .voice-toggle {
    min-height: 2rem;
  }

  .brief-body {
    width: 100%;
    max-width: 800px;
    margin-inline: auto;
  }

  .timeline {
    margin-bottom: 1rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .brief-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.3rem;
    width: 100%;
    box-sizing: border-box;
    padding: 0.55rem 0.75rem;
    border: none;
    border-radius: var(--m3-shape-medium);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .entry:not(.selected) .brief-row:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .brief-date {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.95rem;
    font-weight: 500;
  }

  .badges {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border-radius: var(--m3-shape-full);
    font-size: 0.72rem;
    line-height: 1.4;
    white-space: nowrap;
  }

  .badge.topics {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .badge.sources {
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
  }

  .badge.audio.has-audio {
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .badge.audio:not(.has-audio) {
    border: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }
</style>
