<script lang="ts">
  import { formatTime } from "../lib/format";
  import { Card, Chip, Icon } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconExpandMore from "@ktibow/iconset-material-symbols/expand-more";
  import { statusFeed } from "../lib/statuses.svelte";
  import type { StatusEntry } from "../lib/statusTypes";
  import {
    flattenStatusEntries,
    orderStatusEntries,
    type OrderedStatusEntry,
  } from "../lib/statusOrder";
  import PulseDot from "./PulseDot.svelte";

  interface Props {
    /** Only show entries belonging to this run (correlation id). */
    runId?: string;
    title?: string;
    empty?: string;
  }

  let {
    runId,
    title = "Activity",
    empty = "Idle — nothing has run yet.",
  }: Props = $props();

  let expanded = $state<Record<string, boolean>>({});

  function toggle(key: string): void {
    expanded = { ...expanded, [key]: !expanded[key] };
  }

  // Runs nest their sub-activities; a child without a correlation id still
  // belongs to the run when one of its ancestors carries it.
  const source = $derived.by(() => {
    if (!runId) return statusFeed.entries;
    const byId = new Map(statusFeed.entries.map((entry) => [entry.id, entry]));
    return statusFeed.entries.filter((entry) => {
      let current: StatusEntry | undefined = entry;
      const seen = new Set<string>();
      while (current && !seen.has(current.id)) {
        if (current.correlationId === runId) return true;
        seen.add(current.id);
        current = current.parentId ? byId.get(current.parentId) : undefined;
      }
      return false;
    });
  });

  // Running entries are grouped at the bottom; settled history stays above;
  // sub-activities are nested under the task they belong to.
  const ordered = $derived(orderStatusEntries(source));
  const flat = $derived(flattenStatusEntries(ordered));
  const runningCount = $derived(
    flat.filter((entry) => entry.state === "running").length,
  );


  function formatCost(value: number): string {
    return value >= 0.01 ? `$${value.toFixed(2)}` : `$${value.toFixed(4)}`;
  }
</script>

{#snippet row(entry: OrderedStatusEntry)}
  <div
    class="row"
    class:root={entry.depth === 0}
    class:dim={entry.state !== "running"}
    class:failed={entry.state === "failed"}
  >
    <span class="icon">
      {#if entry.state === "running"}
        <PulseDot size={9} />
      {:else if entry.state === "failed"}
        <Icon icon={iconError} size={18} />
      {:else}
        <Icon icon={iconCheck} size={18} />
      {/if}
    </span>
    <span class="body">
      <span class="text">{entry.text}</span>
    </span>
    {#if entry.costUsd && entry.costUsd > 0}
      <span class="cost">{formatCost(entry.costUsd)}</span>
    {/if}
    <span class="time">{formatTime(entry.updatedAt)}</span>
  </div>
  {#if entry.children.length > 0}
    <div class="sub">{@render rows(entry.children, entry.id)}</div>
  {/if}
{/snippet}

{#snippet rows(nodes: OrderedStatusEntry[], groupKey: string)}
  {@const done = nodes.filter((n) => n.state === "done")}
  {#each nodes.filter((n) => n.state !== "done") as entry (entry.id)}
    {@render row(entry)}
  {/each}
  {#if done.length > 0}
    <button
      type="button"
      class="done-toggle"
      class:open={expanded[groupKey]}
      onclick={() => toggle(groupKey)}
    >
      <span class="done-chevron"><Icon icon={iconExpandMore} size={14} /></span>
      {done.length} task{done.length === 1 ? "" : "s"} done
    </button>
    {#if expanded[groupKey]}
      {#each done as entry (entry.id)}
        {@render row(entry)}
      {/each}
    {/if}
  {/if}
{/snippet}

<Card variant="outlined">
  <div class="stack">
    <div class="toolbar">
      <h3>{title}</h3>
      <div class="chips">
        {#if runningCount > 0}
          <span class="tone-accent">
            <Chip variant="assist" icon={iconBolt}>{runningCount} running</Chip>
          </span>
        {:else}
          <span class="tone-success">
            <Chip variant="assist" icon={iconCheck}>idle</Chip>
          </span>
        {/if}
      </div>
    </div>

    <div class="feed">
      {@render rows(ordered, "root")}

      {#if source.length === 0}
        <p class="muted">{empty}</p>
      {/if}
    </div>
  </div>
</Card>

<style>
  .feed {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    gap: var(--space-small);
    align-items: flex-start;
    padding: var(--space-small);
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
    align-items: center;
    flex-shrink: 0;
    height: 1.5rem;
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
    font-size: var(--font-small);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .cost {
    flex: none;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    margin-inline-start: 0.5rem;
  }

  /* Indented sub-activities. */
  .sub {
    display: flex;
    flex-direction: column;
    /* Never let the parent flex column squash a nested section to nothing. */
    flex-shrink: 0;
    gap: 2px;
    margin-inline-start: 1.1rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 1px solid var(--m3c-outline-variant);
  }

  .done-toggle {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: var(--space-small);
    padding: var(--space-small);
    border: none;
    border-radius: var(--m3-shape-full);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    font: inherit;
    font-size: var(--font-small);
    cursor: pointer;
    opacity: 0.75;
  }

  .done-toggle:hover {
    background-color: var(--m3c-surface-container-high);
    opacity: 1;
  }

  .done-chevron {
    display: inline-flex;
    transition: transform 150ms;
  }

  .done-toggle.open .done-chevron {
    transform: rotate(180deg);
  }
</style>
