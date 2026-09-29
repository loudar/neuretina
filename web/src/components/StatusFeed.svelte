<script lang="ts">
  import { Card, Chip, CircularProgressEstimate, Icon } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import { statusFeed } from "../lib/statuses.svelte";
  import {
    flattenStatusEntries,
    orderStatusEntries,
    type OrderedStatusEntry,
  } from "../lib/statusOrder";

  let scroller: HTMLDivElement | undefined = $state();

  // Running entries are grouped at the bottom; settled history stays above;
  // sub-activities are nested (and height-capped) under the task they belong to.
  const ordered = $derived(orderStatusEntries(statusFeed.entries));
  const flat = $derived(flattenStatusEntries(ordered));
  const runningCount = $derived(
    flat.filter((entry) => entry.state === "running").length,
  );

  $effect(() => {
    // Re-sorting (and appends) change the id signature — keep the newest
    // running entries visible at the bottom.
    const signature = flat.map((entry) => entry.id).join("|");
    if (!signature) return;
    scroller?.scrollTo({ top: scroller.scrollHeight });
  });

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }

  /**
   * Nested sections scroll internally and stick to their newest entries, so
   * only the last few actions stay visible. The top fades once there is more
   * above, until you scroll up to read the history.
   */
  function stickToBottom(node: HTMLElement) {
    const sync = () => {
      node.scrollTop = node.scrollHeight;
      node.classList.toggle("overflowing", node.scrollHeight > node.clientHeight + 1);
    };
    const observer = new MutationObserver(sync);
    observer.observe(node, { childList: true, subtree: true });
    const onScroll = () => node.classList.toggle("scrolled", node.scrollTop > 4);
    node.addEventListener("scroll", onScroll);
    sync();

    return {
      destroy() {
        observer.disconnect();
        node.removeEventListener("scroll", onScroll);
      },
    };
  }
</script>

{#snippet rows(nodes: OrderedStatusEntry[])}
  {#each nodes as entry (entry.id)}
    <div class="row" class:dim={entry.state !== "running"} class:failed={entry.state === "failed"}>
      <span class="icon">
        {#if entry.state === "running"}
          <CircularProgressEstimate size={18} thickness={2} />
        {:else if entry.state === "failed"}
          <Icon icon={iconError} size={18} />
        {:else}
          <Icon icon={iconCheck} size={18} />
        {/if}
      </span>
      <span class="body">
        <span class="text">{entry.text}</span>
      </span>
      <span class="time">{formatTime(entry.updatedAt)}</span>
    </div>
    {#if entry.children.length > 0}
      <div class="sub" use:stickToBottom>
        {@render rows(entry.children)}
      </div>
    {/if}
  {/each}
{/snippet}

<Card variant="outlined">
  <div class="stack">
    <div class="toolbar">
      <h3>Activity</h3>
      <div class="chips">
        {#if runningCount > 0}
          <Chip variant="assist" icon={iconBolt}>{runningCount} running</Chip>
        {:else}
          <Chip variant="assist" icon={iconCheck}>idle</Chip>
        {/if}
      </div>
    </div>

    <div class="feed" bind:this={scroller}>
      {@render rows(ordered)}

      {#if statusFeed.entries.length === 0}
        <p class="muted">Idle — nothing has run yet.</p>
      {/if}
    </div>
  </div>
</Card>

<style>
  .feed {
    max-height: 11rem;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    gap: 0.6rem;
    align-items: flex-start;
    padding: 0.25rem 0.4rem;
    border-radius: var(--m3-shape-small);
  }

  .row.dim {
    opacity: 0.6;
  }

  .row.failed {
    color: var(--m3c-error);
    opacity: 0.85;
  }

  .icon {
    display: inline-flex;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .text {
    overflow-wrap: anywhere;
  }

  .time {
    margin-inline-start: auto;
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Indented sub-activities: capped height, newest at the bottom. */
  .sub {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-inline-start: 1.1rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 1px solid var(--m3c-outline-variant);
    max-height: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  .sub.overflowing.scrolled {
    mask-image: linear-gradient(to bottom, transparent 0, black 2.5rem);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 2.5rem);
  }
</style>
