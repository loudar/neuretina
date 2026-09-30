<script lang="ts">
  import type { BriefSource } from "../lib/api";
  import { renderCitations } from "../lib/citations";
  import { markdownToHtml } from "../../../src/core/markdown.ts";

  interface Props {
    markdown: string;
    sources?: BriefSource[];
  }

  let { markdown, sources = [] }: Props = $props();

  const html = $derived(renderCitations(markdownToHtml(markdown), sources));
</script>

<div class="markdown">{@html html}</div>

<style>
  .markdown {
    padding: 0.25rem 0;
    font-size: 0.95rem;
    line-height: 1.55;
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
