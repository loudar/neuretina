<script lang="ts">
  import type { BriefSource } from "../lib/api";
  import { renderCitations } from "../lib/citations";
  import { READING_SIZES, readingPrefs, type ReadingSize } from "../lib/reading.svelte";
  import { markdownToHtml } from "../../../src/core/markdown.ts";

  interface Props {
    markdown: string;
    sources?: BriefSource[];
  }

  let { markdown, sources = [] }: Props = $props();

  const html = $derived(renderCitations(markdownToHtml(markdown), sources));

  function sizeTitle(size: ReadingSize): string {
    if (size === "small") return "Small text";
    if (size === "medium") return "Medium text";
    return "Large text";
  }
</script>

<!-- Reading controls live here so brief and artifact details stay in sync. -->
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
    gap: 0.1rem;
    margin-bottom: 0.15rem;
  }

  .aa {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.8rem;
    height: 1.7rem;
    padding: 0 0.4rem;
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
    font-size: 0.72rem;
  }

  .aa.medium {
    font-size: 0.85rem;
  }

  .aa.large {
    font-size: 1rem;
  }

  .markdown {
    padding: 0.25rem 0;
    font-size: var(--markdown-font-size, calc(0.95rem + 2px));
    line-height: 1.55;
    text-align: justify;
  }

  .markdown :global(> :first-child) {
    margin-top: 0;
  }

  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 0.9rem 0 0.4rem;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .markdown :global(p) {
    margin: 0 0 0.7rem;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0 0 0.7rem;
    padding-inline-start: 1.25rem;
  }

  .markdown :global(li) {
    margin-bottom: 0.2rem;
  }

  .markdown :global(blockquote) {
    margin: 0 0 0.7rem;
    padding-inline-start: 0.75rem;
    border-inline-start: 3px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }

  .markdown :global(a) {
    color: var(--m3c-primary);
  }

  .markdown :global(code) {
    padding: 0.05rem 0.3rem;
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-high);
    font-size: 0.85em;
  }
</style>
