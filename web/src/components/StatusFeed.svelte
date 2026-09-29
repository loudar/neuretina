<script lang="ts">
  import { Card, Chip, CircularProgressEstimate, Icon } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import { statusFeed } from "../lib/statuses.svelte";
  import type { StatusEntry } from "../lib/statusTypes";
  import {
    flattenStatusEntries,
    orderStatusEntries,
    type OrderedStatusEntry,
  } from "../lib/statusOrder";

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

  let scroller: HTMLDivElement | undefined = $state();

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
  // sub-activities are nested (and height-capped) under the task they belong to.
  const ordered = $derived(orderStatusEntries(source));
  const flat = $derived(flattenStatusEntries(ordered));
  const runningCount = $derived(
    flat.filter((entry) => entry.state === "running").length,
  );

  $effect(() => {
    // Re-sorting (and appends) change the id signature — keep the newest
    // running entries visible. The newest root task is kept in view (it is the
    // parent of the nested section below it); the sub-activities scroll
    // internally, so only they get clipped, never the parent.
    const signature = flat.map((entry) => entry.id).join("|");
    if (!signature || !scroller) return;

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const roots = scroller.querySelectorAll<HTMLElement>(".row.root");
    const lastRoot = roots.length > 0 ? roots[roots.length - 1]! : null;
    if (!lastRoot) {
      scroller.scrollTo({ top: maxScroll });
      return;
    }

    const remaining = scroller.scrollHeight - lastRoot.offsetTop;
    const target = remaining <= scroller.clientHeight ? maxScroll : lastRoot.offsetTop;
    scroller.scrollTo({ top: Math.max(0, Math.min(target, maxScroll)) });
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
      const last = node.lastElementChild as HTMLElement | null;
      const maxScroll = Math.max(0, node.scrollHeight - node.clientHeight);

      if (last) {
        // A short entry is bottom-aligned like a log line; a long one (a full
        // follow-up question) is shown from its start so the current task
        // stays readable instead of being cut off mid-sentence.
        const fits = last.offsetHeight <= node.clientHeight;
        const target = fits
          ? last.offsetTop + last.offsetHeight - node.clientHeight
          : last.offsetTop;
        node.scrollTop = Math.max(0, Math.min(target, maxScroll));
        node.classList.toggle("tall-current", !fits);
      }

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
    <div
      class="row"
      class:root={entry.depth === 0}
      class:dim={entry.state !== "running"}
      class:failed={entry.state === "failed"}
    >
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
      <h3>{title}</h3>
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

      {#if source.length === 0}
        <p class="muted">{empty}</p>
      {/if}
    </div>
  </div>
</Card>

<style>
  .feed {
    position: relative;
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
    position: relative;
    display: flex;
    flex-direction: column;
    /* Never let the parent flex column squash a nested section to nothing. */
    flex-shrink: 0;
    gap: 2px;
    margin-inline-start: 1.1rem;
    padding-inline-start: 0.5rem;
    border-inline-start: 1px solid var(--m3c-outline-variant);
    /* Keep the section to roughly three rows so the parent task stays visible. */
    max-height: 6.5rem;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
  }

  /* Fade the top only when history is above and the current entry is short;
     a long current task is shown from its start and must stay readable. */
  .sub.overflowing.scrolled:not(.tall-current) {
    mask-image: linear-gradient(to bottom, transparent 0, black 2rem);
    -webkit-mask-image: linear-gradient(to bottom, transparent 0, black 2rem);
  }
</style>
