<script lang="ts">
  import { fetchSharedBrief, type SharedBrief } from "../lib/api";
  import { formatDateTime } from "../lib/format";
  import MarkdownView from "./MarkdownView.svelte";
  import TimelineView from "./TimelineView.svelte";

  interface Props {
    /** Anonymous read-only token from the delivery link. */
    token: string;
  }

  let { token }: Props = $props();

  let brief = $state<SharedBrief | null>(null);
  let error = $state<string | null>(null);

  const audioUrl = $derived(
    brief?.hasAudio ? `/api/share/brief/${encodeURIComponent(token)}/audio` : null,
  );

  $effect(() => {
    const requested = token;
    let cancelled = false;
    brief = null;
    error = null;
    fetchSharedBrief(requested)
      .then((value) => {
        if (!cancelled) brief = value;
      })
      .catch(() => {
        if (!cancelled) error = "This brief is no longer available.";
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<main class="share">
  <header class="share-header">
    <span class="brand">Neuretina</span>
    {#if brief}
      <h1>{brief.topics.join(", ") || "Brief"}</h1>
      <p class="muted">
        {formatDateTime(brief.createdAt)}{brief.audioDurationMs
          ? ` · ${Math.round(brief.audioDurationMs / 1000)}s audio`
          : ""}
      </p>
    {/if}
  </header>

  {#if error}
    <p class="muted">{error}</p>
  {:else if !brief}
    <p class="muted">Loading…</p>
  {:else}
    {#if brief.timeline}
      <div class="timeline">
        <TimelineView artifact={brief.timeline.artifact} events={brief.timeline.events} />
      </div>
    {/if}
    {#if audioUrl}
      <audio controls src={audioUrl}></audio>
    {/if}
    <MarkdownView markdown={brief.markdown} sources={brief.sources} />
  {/if}
</main>

<style>
  .share {
    min-height: 100dvh;
    box-sizing: border-box;
    padding: var(--space-large) var(--space-medium) 4rem;
  }

  .share-header {
    width: 100%;
    max-width: 800px;
    margin: 0 auto var(--space-large);
    padding-bottom: var(--space-small);
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .brand {
    display: block;
    margin-bottom: var(--space-small);
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0 0 var(--space-small);
    font-size: var(--font-large);
    font-weight: 600;
    line-height: 1.4;
  }

  .muted {
    width: 100%;
    max-width: 800px;
    margin-inline: auto;
    color: var(--m3c-on-surface-variant);
  }

  audio {
    display: block;
    width: 100%;
    max-width: 800px;
    margin: 0 auto var(--space-medium);
  }

  .timeline {
    width: 100%;
    max-width: 800px;
    margin: 0 auto var(--space-medium);
  }
</style>
