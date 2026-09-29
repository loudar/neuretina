<script lang="ts">
  import { Button, Dialog, Icon, ListItem, Switch, TextFieldOutlined } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconClose from "@ktibow/iconset-material-symbols/close";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconExpandMore from "@ktibow/iconset-material-symbols/expand-more";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconLink from "@ktibow/iconset-material-symbols/link";
  import iconMic from "@ktibow/iconset-material-symbols/mic";
  import iconMicOff from "@ktibow/iconset-material-symbols/mic-off";
  import iconOpenInNew from "@ktibow/iconset-material-symbols/open-in-new";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSearch from "@ktibow/iconset-material-symbols/search";
  import iconSend from "@ktibow/iconset-material-symbols/send";
  import { commands, type Brief } from "../lib/api";
  import { renderCitations } from "../lib/citations";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime, formatListDate, formatRelativeTime } from "../lib/format";
  import { useRefresh } from "../lib/refresh.svelte";
  import {
    domainInitial,
    filterSources,
    groupSourcesByDomain,
    providerLabel,
  } from "../lib/sources";
  import { markdownToHtml } from "../../../src/core/markdown.ts";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";

  let briefs = $state<Brief[]>([]);
  let selected = $state<Brief | null>(null);
  let audioUrl = $state<string | null>(null);
  let busy = $state(false);
  let resending = $state(false);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let generating = $state(false);
  let voiceEnabled = $state(true);
  let sourceFilter = $state("");

  const filteredSources = $derived(filterSources(selected?.sources ?? [], sourceFilter));
  const sourceGroups = $derived(groupSourcesByDomain(filteredSources));
  const filtering = $derived(sourceFilter.trim().length > 0);
  const briefHtml = $derived(
    renderCitations(markdownToHtml(selected?.markdown ?? ""), selected?.sources ?? []),
  );

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
      sourceFilter = "";
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
</script>

<Pane variant="list" title="Briefs">
  {#snippet actions()}
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
    </label>
    <Button variant="tonal" iconType="left" onclick={runNow} disabled={busy}>
      <Icon icon={iconPlay} /> Run now
    </Button>
  {/snippet}

  <DataList items={briefs} empty="No briefs yet. Run one now or wait for the scheduled task.">
    {#snippet children(brief)}
      <div class="entry" class:selected={selected?.id === brief.id}>
        <ListItem onclick={() => select(brief.id)} headline={formatListDate(brief.createdAt)}>
          {#snippet leading()}
            <Icon icon={iconArticle} />
          {/snippet}
          {#snippet trailing()}
            <div class="badges">
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
            </div>
          {/snippet}
        </ListItem>
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
    {/if}
  {/snippet}

  {#if selected}
    {#if audioUrl}
      <audio controls src={audioUrl}></audio>
    {:else if selected.hasAudio}
      <p class="muted">Loading audio…</p>
    {/if}

    <div class="brief-text">{@html briefHtml}</div>

    {#if selected.sources.length > 0}
      <div class="source-section">
        <div class="source-section-head">
          <h3>Sources</h3>
          <span class="total">
            {filtering
              ? `${filteredSources.length} of ${selected.sources.length}`
              : selected.sources.length}
          </span>
        </div>
        <TextFieldOutlined
          label="Filter sources"
          leadingIcon={iconSearch}
          bind:value={sourceFilter}
          trailing={filtering
            ? { icon: iconClose, onclick: () => (sourceFilter = "") }
            : undefined}
        />
        {#if sourceGroups.length === 0}
          <p class="muted">No sources match "{sourceFilter.trim()}".</p>
        {:else}
          <div class="source-groups">
            {#each sourceGroups as group (group.domain)}
              <details class="source-group" open={filtering}>
                <summary>
                  <span class="monogram" aria-hidden="true">{domainInitial(group.domain)}</span>
                  <span class="domain">{group.domain}</span>
                  <span class="count">{group.sources.length}</span>
                  <span class="provider-tags">
                    {#each group.providers as provider (provider)}
                      <span class="provider-tag" data-provider={provider}>
                        {providerLabel(provider)}
                      </span>
                    {/each}
                  </span>
                  <span class="chevron"><Icon icon={iconExpandMore} size={18} /></span>
                </summary>
                <ul>
                  {#each group.sources as source (source.url)}
                    <li class="source">
                      <a class="source-head" href={source.url} target="_blank" rel="noreferrer">
                        <span class="title">{source.title}</span>
                        <span class="open" aria-hidden="true">
                          <Icon icon={iconOpenInNew} size={15} />
                        </span>
                      </a>
                      {#if source.provider === "bluesky" && source.snippet}
                        <p class="snippet">{source.snippet}</p>
                      {/if}
                      {#if source.media?.length}
                        <div class="media">
                          {#each source.media as item, index (item.thumbUrl + index)}
                            <a
                              class="media-item"
                              href={item.type === "video" ? source.url : item.fullUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={item.alt ?? "Open media"}
                            >
                              <img
                                src={item.thumbUrl}
                                alt={item.alt ?? ""}
                                loading="lazy"
                                width={item.width}
                                height={item.height}
                                style={item.width && item.height
                                  ? `aspect-ratio: ${item.width} / ${item.height};`
                                  : ""}
                              />
                              {#if item.type === "video"}
                                <span class="play" aria-hidden="true">
                                  <Icon icon={iconPlay} size={18} />
                                </span>
                              {/if}
                            </a>
                          {/each}
                        </div>
                      {/if}
                    </li>
                  {/each}
                </ul>
              </details>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  {:else}
    <p class="muted">Select a brief to read it and play the audio.</p>
  {/if}

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
</Pane>

<style>
  audio {
    width: 100%;
    margin-bottom: 0.75rem;
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

  .brief-text {
    padding: 0.25rem 0;
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .brief-text :global(> :first-child) {
    margin-top: 0;
  }

  .brief-text :global(h2),
  .brief-text :global(h3),
  .brief-text :global(h4) {
    margin: 0.9rem 0 0.4rem;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .brief-text :global(p) {
    margin: 0 0 0.7rem;
  }

  .brief-text :global(ul),
  .brief-text :global(ol) {
    margin: 0 0 0.7rem;
    padding-inline-start: 1.25rem;
  }

  .brief-text :global(li) {
    margin-bottom: 0.2rem;
  }

  .brief-text :global(blockquote) {
    margin: 0 0 0.7rem;
    padding-inline-start: 0.75rem;
    border-inline-start: 3px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }

  .brief-text :global(a) {
    color: var(--m3c-primary);
  }

  .brief-text :global(a.cite) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25em;
    height: 1.25em;
    padding: 0 0.35em;
    margin: 0 0.1em;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    vertical-align: 0.2em;
  }

  .brief-text :global(a.cite:hover) {
    background-color: var(--m3c-primary-container);
    color: var(--m3c-on-primary-container);
  }

  .brief-text :global(code) {
    padding: 0.05rem 0.3rem;
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-high);
    font-size: 0.85em;
  }

  .source-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1rem;
  }

  .source-section-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .total {
    padding: 0.05rem 0.5rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .source-groups {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .source-group {
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background-color: var(--m3c-surface-container-low);
    overflow: hidden;
  }

  .source-group summary {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .source-group summary::-webkit-details-marker {
    display: none;
  }

  .source-group summary:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .monogram {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .domain {
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
  }

  .provider-tags {
    display: inline-flex;
    gap: 0.3rem;
    margin-left: auto;
  }

  .provider-tag {
    padding: 0.05rem 0.45rem;
    border-radius: var(--m3-shape-full);
    border: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.5;
    white-space: nowrap;
  }

  .provider-tag[data-provider="perplexity"] {
    border-color: transparent;
    background-color: var(--m3c-primary-container);
    color: var(--m3c-on-primary-container);
  }

  .provider-tag[data-provider="bluesky"] {
    border-color: transparent;
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .chevron {
    display: inline-flex;
    color: var(--m3c-on-surface-variant);
    transition: transform 150ms;
  }

  .source-group[open] .chevron {
    transform: rotate(180deg);
  }

  .source-group ul {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0 0.4rem 0.4rem;
    list-style: none;
  }

  .source {
    padding: 0.5rem 0.6rem;
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-highest);
  }

  .source:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .source-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--m3c-on-surface);
    text-decoration: none;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: 0.88rem;
    line-height: 1.35;
  }

  .open {
    display: inline-flex;
    color: var(--m3c-on-surface-variant);
    opacity: 0;
    transition: opacity 120ms;
  }

  .source-head:hover .open,
  .source-head:focus-visible .open {
    opacity: 1;
  }

  .snippet {
    margin: 0.2rem 0 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--m3c-on-surface-variant);
    white-space: pre-wrap;
  }

  .media {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.45rem;
  }

  .media-item {
    position: relative;
    display: inline-flex;
    border-radius: var(--m3-shape-small);
    overflow: hidden;
  }

  .media img {
    display: block;
    height: 7rem;
    width: auto;
    max-width: 100%;
    object-fit: cover;
    background-color: var(--m3c-surface-container-highest);
  }

  .media-item:hover img {
    opacity: 0.9;
  }

  .play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    background-color: rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
</style>
