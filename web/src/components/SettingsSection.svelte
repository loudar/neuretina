<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    group: string;
    id?: string;
    children: Snippet;
  }

  let { group, id, children }: Props = $props();
</script>

<!-- Each section is its own card, so a section boundary is always visible. -->
<section class="group" {id}>
  <h3>{group}</h3>
  {@render children()}
</section>

<style>
  .group {
    box-sizing: border-box;
    max-width: 60rem;
    padding: var(--space-medium) var(--space-large);
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-large);
    background-color: var(--m3c-surface-container-low);
    box-shadow: var(--m3-elevation-1);
  }

  .group h3 {
    @apply --m3-title-small;
    margin: 0 0 var(--space-small);
    padding: 0 0 var(--space-small);
    border-bottom: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface);
  }

  /* Rows come from sibling components, so the separator is global within the
     (scoped) section. */
  .group :global(.setting + .setting) {
    border-top: 1px solid var(--m3c-outline-variant);
  }
</style>
