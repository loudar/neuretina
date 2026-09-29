<script lang="ts">
  import { Card, Chip, CircularProgressEstimate, Icon } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import { statusFeed } from "../lib/statuses.svelte";
  import { sortStatusEntries } from "../lib/statusOrder";

  let scroller: HTMLDivElement | undefined = $state();

  // Running entries are grouped at the bottom; settled history stays above.
  const ordered = $derived(sortStatusEntries(statusFeed.entries));
  const runningCount = $derived(
    ordered.filter((entry) => entry.state === "running").length,
  );

  $effect(() => {
    // Re-sorting (and appends) change the id signature — keep the newest
    // running entries visible at the bottom.
    const signature = ordered.map((entry) => entry.id).join("|");
    if (!signature) return;
    scroller?.scrollTo({ top: scroller.scrollHeight });
  });

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
</script>

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
      {#each ordered as entry (entry.id)}
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
            {#if entry.detail}
              <span class="detail">{entry.detail}</span>
            {/if}
          </span>
          <span class="time">{formatTime(entry.updatedAt)}</span>
        </div>
      {/each}

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

  .detail {
    color: var(--m3c-on-surface-variant);
    font-size: 0.8rem;
    overflow-wrap: anywhere;
  }

  .time {
    margin-inline-start: auto;
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    white-space: nowrap;
    flex-shrink: 0;
  }
</style>
