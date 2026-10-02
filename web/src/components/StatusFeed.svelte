<script lang="ts">
  import { Card, Chip, Icon } from "m3-svelte";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import { statusFeed } from "../lib/statuses.svelte";
  import type { StatusEntry } from "../lib/statusTypes";
  import { flattenStatusEntries, orderStatusEntries } from "../lib/statusOrder";
  import StatusNode from "./StatusNode.svelte";

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

  // Chronological, top to bottom; subactions nest under their parent.
  const ordered = $derived(orderStatusEntries(source));
  const flat = $derived(flattenStatusEntries(ordered));
  const runningCount = $derived(flat.filter((entry) => entry.state === "running").length);
</script>

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
      {#each ordered as entry (entry.id)}
        <StatusNode {entry} />
      {/each}

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
</style>
