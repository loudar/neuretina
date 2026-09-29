<script lang="ts">
  import { Button, Chip, Icon, ListItem } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import { commands, type Brief } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import { formatDateTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Panel from "./Panel.svelte";

  let briefs = $state<Brief[]>([]);
  let selected = $state<Brief | null>(null);
  let audioUrl = $state<string | null>(null);
  let busy = $state(false);

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
      await commands.workflows.run("briefing");
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  }

  useRefresh(["brief.generated", "tts.synthesized", "message.voice.sent"], async () => {
    await refreshList();
    if (selected) await select(selected.id);
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
      <Button variant="tonal" iconType="left" onclick={runNow} disabled={busy}>
        <Icon icon={iconPlay} /> Run briefing now
      </Button>
    </div>

    <DataList items={briefs} empty="No briefs yet. Run one now or wait for the scheduled task.">
      {#snippet children(brief)}
        <ListItem
          onclick={() => select(brief.id)}
          headline={formatDateTime(brief.createdAt)}
          supporting={listItemSupporting(brief)}
        >
          {#snippet leading()}
            <Icon icon={iconArticle} />
          {/snippet}
        </ListItem>
      {/snippet}
    </DataList>
  </Panel>

  <Panel>
    {#if selected}
      <h2>{selected.topics.join(", ") || "Untitled brief"}</h2>
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

<style>
  audio {
    width: 100%;
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
