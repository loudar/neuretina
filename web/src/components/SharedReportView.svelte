<script lang="ts">
  import { fetchSharedReport, type SharedReport } from "../lib/api";
  import { formatDateTime } from "../lib/format";
  import MarkdownView from "./MarkdownView.svelte";
  import TimelineView from "./TimelineView.svelte";

  interface Props {
    /** Anonymous read-only token from the delivery link. */
    token: string;
  }

  let { token }: Props = $props();

  let report = $state<SharedReport | null>(null);
  let error = $state<string | null>(null);

  const audioUrl = $derived(
    report?.hasAudio ? `/api/share/report/${encodeURIComponent(token)}/audio` : null,
  );

  $effect(() => {
    const requested = token;
    let cancelled = false;
    report = null;
    error = null;
    fetchSharedReport(requested)
      .then((value) => {
        if (!cancelled) report = value;
      })
      .catch(() => {
        if (!cancelled) error = "This report is no longer available.";
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<main class="share">
  <header class="share-header">
    <span class="brand">Neuretina</span>
    {#if report}
      <h1>{report.topics.join(", ") || "Report"}</h1>
      <p class="muted">
        {formatDateTime(report.createdAt)}{report.audioDurationMs
          ? ` · ${Math.round(report.audioDurationMs / 1000)}s audio`
          : ""}
      </p>
    {/if}
  </header>

  {#if error}
    <p class="muted">{error}</p>
  {:else if !report}
    <p class="muted">Loading…</p>
  {:else}
    {#if report.timeline}
      <div class="timeline">
        <TimelineView artifact={report.timeline.artifact} events={report.timeline.events} />
      </div>
    {/if}
    {#if audioUrl}
      <audio controls src={audioUrl}></audio>
    {/if}
    <MarkdownView markdown={report.markdown} sources={report.sources} />
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
