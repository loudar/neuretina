<script lang="ts" generics="T extends { id: string }">
  import { Divider } from "m3-svelte";
  import type { Snippet } from "svelte";

  let {
    items,
    empty = "Nothing here yet.",
    children,
  }: { items: T[]; empty?: string; children: Snippet<[T]> } = $props();
</script>

{#if items.length === 0}
  <p class="muted">{empty}</p>
{:else}
  <div class="list">
    {#each items as item, index (item.id)}
      {#if index > 0}<Divider />{/if}
      {@render children(item)}
    {/each}
  </div>
{/if}

<style>
  /* Keeps rows flush; the parent stack gap must not stretch the list. */
  .list {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
</style>
