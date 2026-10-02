<script lang="ts">
  import type { ReportSource } from "../lib/api";
  import { renderCitations } from "../lib/citations";
  import { READING_SIZES, readingPrefs, type ReadingSize } from "../lib/reading.svelte";
  import { markdownToHtml } from "../../../src/core/markdown.ts";
  import SourcesList from "./SourcesList.svelte";

  interface Props {
    markdown: string;
    sources?: ReportSource[];
    /** Optional controlled source filter (the reports view keeps it in the URL). */
    filter?: string;
    onfilter?: (value: string) => void;
  }

  let { markdown, sources = [], filter, onfilter }: Props = $props();

  const html = $derived(renderCitations(markdownToHtml(markdown), sources));

  function sizeTitle(size: ReadingSize): string {
    if (size === "small") return "Small text";
    if (size === "medium") return "Medium text";
    return "Large text";
  }
</script>

<!-- Reading controls live here so report and artifact details stay in sync. -->
<div class="reading" style:--markdown-font-size={readingPrefs.css}>
  <span class="reading-sizes" role="group" aria-label="Reading size">
    {#each READING_SIZES as size (size)}
      <button
        type="button"
        class="aa {size}"
        class:active={readingPrefs.size === size}
        aria-pressed={readingPrefs.size === size}
        title={sizeTitle(size)}
        onclick={() => readingPrefs.setSize(size)}
      >
        aA
      </button>
    {/each}
  </span>

  <div class="markdown">{@html html}</div>

  <SourcesList {sources} {filter} {onfilter} />
</div>

<style>
  /* Comfortable line length for long-form reading in every view. */
  .reading {
    width: 100%;
    max-width: 800px;
    margin-inline: auto;
  }

  .reading-sizes {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-small);
    margin-bottom: 0;
  }

  .aa {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    height: 1.7rem;
    padding: 0 var(--space-small);
    border: none;
    border-radius: var(--m3-shape-full);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    cursor: pointer;
    font-weight: 600;
    line-height: 1;
  }

  .aa:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .aa.active {
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .aa.small {
    font-size: var(--font-small);
  }

  .aa.medium {
    font-size: var(--font-medium);
  }

  .aa.large {
    font-size: var(--font-large);
  }

  .markdown {
    padding: var(--space-large) 0;
    font-size: var(--markdown-font-size, calc(var(--font-medium) + 2px));
    line-height: 1.55;
    text-align: justify;
  }

  .markdown :global(> :first-child) {
    margin-top: 0;
  }

  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: var(--space-large) 0 var(--space-small);
    font-size: var(--font-large);
    font-weight: 600;
  }

  .markdown :global(p) {
    margin: 0 0 var(--space-medium);
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0 0 var(--space-medium);
    padding-inline-start: 1.25rem;
  }

  .markdown :global(li) {
    margin-bottom: 0;
  }

  .markdown :global(blockquote) {
    margin: 0 0 var(--space-medium);
    padding-inline-start: 0.75rem;
    border-inline-start: 3px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }

  .markdown :global(a) {
    color: var(--m3c-primary);
  }

  .markdown :global(code) {
    padding: 0 var(--space-large);
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-high);
    font-size: 0.85em;
  }
</style>
