<script lang="ts">
  import { Button, Chip, Dialog, Icon, ListItem, Switch } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconMic from "@ktibow/iconset-material-symbols/mic";
  import iconMicOff from "@ktibow/iconset-material-symbols/mic-off";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSend from "@ktibow/iconset-material-symbols/send";
  import { commands, type Brief } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Panel from "./Panel.svelte";

  let briefs = $state<Brief[]>([]);
  let selected = $state<Brief | null>(null);
  let audioUrl = $state<string | null>(null);
  let busy = $state(false);
  let resending = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let generating = $state(false);
  let voiceEnabled = $state(true);

  async function refreshList(): Promise<void> {
    try {
      briefs = await commands.briefs.list();
    } catch (error) {
      reportError(error);
    }
  }

  async function select(id: string): Promise<void> {
    try {
      const brief = await commands.briefs.get(id);
      selected = brief;
      audioUrl = null;
      if (brief.hasAudio) {
        const audio = await commands.briefs.audio(id);
        audioUrl = audio?.dataUrl ?? null;
      }
    } catch (error) {
      reportError(error);
    }
  }

  async function runNow(): Promise<void> {
    busy = true;
    try {
      await commands.workflows.run("briefing", { generateAudio: voiceEnabled });
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  }

  async function resend(): Promise<void> {
    if (!selected || resending) return;
    resending = true;
    try {
      const result = await commands.briefs.send(selected.id);
      reportSuccess(`Brief re-sent (${result.sent.length} message(s))`);
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
    deleting = true;
    try {
      await commands.briefs.remove(selected.id);
      selected = null;
      audioUrl = null;
      confirmingDelete = false;
      reportSuccess("Brief deleted");
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }

  useRefresh(["brief.generated", "tts.synthesized", "message.voice.sent", "brief.deleted"], async () => {
    await refreshList();
    if (!selected) return;
    // The selected brief may have been deleted (here or elsewhere).
    if (!briefs.some((brief) => brief.id === selected?.id)) {
      selected = null;
      audioUrl = null;
      return;
    }
    await select(selected.id);
  });

  function listItemSupporting(brief: Brief): string {
    const topics = brief.topics.join(", ") || "untitled";
    const audio = brief.hasAudio ? " · audio ready" : "";
    return `${topics} · ${brief.sources.length} sources${audio}`;
  }
</script>

<div class="row two">
  <Panel>
    <div class="toolbar">
      <h2>Briefs</h2>
      <div class="actions">
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
        <Button variant="tonal" iconType="left" onclick={runNow} disabled={busy}>
          <Icon icon={iconPlay} /> Run briefing now
        </Button>
      </div>
    </div>

    <DataList items={briefs} empty="No briefs yet. Run one now or wait for the scheduled task.">
      {#snippet children(brief)}
        <div class="entry" class:selected={selected?.id === brief.id}>
          <ListItem
            onclick={() => select(brief.id)}
            headline={formatDateTime(brief.createdAt)}
            supporting={listItemSupporting(brief)}
          >
            {#snippet leading()}
              <Icon icon={iconArticle} />
            {/snippet}
          </ListItem>
        </div>
      {/snippet}
    </DataList>
  </Panel>

  <Panel>
    {#if selected}
      <div class="toolbar">
        <h2>{selected.topics.join(", ") || "Untitled brief"}</h2>
        <div class="actions">
          {#if !selected.hasAudio}
            <Button variant="tonal" iconType="left" onclick={generateVoice} disabled={generating}>
              <Icon icon={iconMic} /> {generating ? "Generating…" : "Generate voice"}
            </Button>
          {/if}
          <Button variant="tonal" iconType="left" onclick={resend} disabled={resending}>
            <Icon icon={iconSend} /> Re-send
          </Button>
          <Button
            variant="text"
            iconType="full"
            onclick={() => (confirmingDelete = true)}
            disabled={deleting}
          >
            <Icon icon={iconDelete} />
          </Button>
        </div>
      </div>
      <p class="muted">
        {formatDateTime(selected.createdAt)} · {selected.sources.length} sources
        {selected.audioDurationMs ? `· ${Math.round(selected.audioDurationMs / 1000)}s audio` : ""}
      </p>

      {#if audioUrl}
        <audio controls src={audioUrl}></audio>
      {:else if selected.hasAudio}
        <p class="muted">Loading audio…</p>
      {/if}

      <pre class="brief-text">{selected.markdown}</pre>

      {#if selected.sources.length > 0}
        <h3>Sources</h3>
        <ol class="source-list muted">
          {#each selected.sources as source (source.url)}
            <li>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
              <Chip variant="input">{source.provider}</Chip>
            </li>
          {/each}
        </ol>
      {/if}
    {:else}
      <h2>Brief details</h2>
      <p class="muted">Select a brief to read it and play the audio.</p>
    {/if}
  </Panel>
</div>

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
    <Button variant="filled" onclick={deleteSelected} disabled={deleting}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  audio {
    width: 100%;
  }

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

  .entry {
    border-radius: var(--m3-shape-medium);
    transition: background-color 150ms;
  }

  .entry.selected {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .brief-text {
    white-space: pre-wrap;
    font: inherit;
    margin: 0;
    max-height: 30rem;
    overflow: auto;
    padding: 0.25rem 0;
  }

  .source-list {
    margin: 0;
    padding-inline-start: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
</style>
