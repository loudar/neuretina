<script lang="ts">
  import { Icon } from "m3-svelte";
  import iconViewStream from "@ktibow/iconset-material-symbols/view-stream";
  import iconViewWeek from "@ktibow/iconset-material-symbols/view-week";
  import { commands } from "../lib/commands";
  import type { ArtifactInfo, TimelineEvent } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import type { TimelineLabelEntry } from "../lib/timeline";
  import { timelinePrefs, type TimelineOrientation } from "../lib/timeline.svelte";
  import HorizontalTimeline from "./HorizontalTimeline.svelte";
  import TimelinePopover from "./TimelinePopover.svelte";
  import VerticalTimeline from "./VerticalTimeline.svelte";

  interface Props {
    artifact: ArtifactInfo;
    /** Preloaded events (anonymous share view); otherwise loaded over the session. */
    events?: TimelineEvent[];
  }

  let { artifact, events: preloadedEvents }: Props = $props();

  const popoverId = `${crypto.randomUUID()}-popover`;

  let fetchedEvents = $state<TimelineEvent[] | null>(null);
  let fetching = $state(true);

  const events = $derived(preloadedEvents ?? fetchedEvents);
  const loading = $derived(preloadedEvents === undefined && fetching);

  interface ActivePopover {
    key: string;
    events: TimelineEvent[];
    x: number;
    y: number;
    above: boolean;
  }

  let activePopover = $state<ActivePopover | null>(null);

  /**
   * Popovers are fixed-position and driven by JS: the horizontal track scrolls,
   * and an absolutely positioned popover would be clipped by the scroll box.
   */
  function openPopover(event: MouseEvent | FocusEvent, entry: TimelineLabelEntry): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const width = Math.min(448, window.innerWidth * 0.8);
    const above = rect.bottom + 190 > window.innerHeight;
    activePopover = {
      key: entry.key,
      events: entry.events,
      x: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      y: above ? rect.top - 6 : rect.bottom + 6,
      above,
    };
  }

  function closePopover(): void {
    activePopover = null;
  }

  const eventIds = $derived(
    Array.isArray(artifact.metadata.eventIds)
      ? artifact.metadata.eventIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [],
  );

  $effect(() => {
    if (preloadedEvents !== undefined) return;
    const ids = eventIds;
    fetchedEvents = null;
    fetching = true;
    if (ids.length === 0) {
      fetching = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await commands.timeline.events(ids);
        if (!cancelled) fetchedEvents = loaded;
      } catch (error) {
        if (!cancelled) reportError(error);
      } finally {
        if (!cancelled) fetching = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  const orientation = $derived(timelinePrefs.orientation);

  function setOrientation(next: TimelineOrientation): void {
    timelinePrefs.setOrientation(next);
  }
</script>

<div class="timeline-view">
  <div class="timeline-head">
    <span class="timeline-title">Timeline</span>
    {#if events}
      <span class="timeline-count" title={`${events.length} event(s)`}>{events.length}</span>
    {/if}
    <span class="view-toggle" role="group" aria-label="Timeline orientation">
      <button
        type="button"
        class="view"
        class:active={orientation === "horizontal"}
        aria-pressed={orientation === "horizontal"}
        title="Horizontal timeline"
        onclick={() => setOrientation("horizontal")}
      >
        <Icon icon={iconViewWeek} size={17} />
      </button>
      <button
        type="button"
        class="view"
        class:active={orientation === "vertical"}
        aria-pressed={orientation === "vertical"}
        title="Vertical timeline"
        onclick={() => setOrientation("vertical")}
      >
        <Icon icon={iconViewStream} size={17} />
      </button>
    </span>
  </div>

  {#if loading}
    <p class="muted">Loading timeline…</p>
  {:else if !events || events.length === 0}
    <p class="muted">No events in this timeline.</p>
  {:else if orientation === "horizontal"}
    <HorizontalTimeline
      {events}
      activeKey={activePopover?.key}
      {popoverId}
      onopen={openPopover}
      onclose={closePopover}
    />
  {:else}
    <VerticalTimeline
      {events}
      activeKey={activePopover?.key}
      {popoverId}
      onopen={openPopover}
      onclose={closePopover}
    />
  {/if}

  {#if activePopover}
    <TimelinePopover
      id={popoverId}
      events={activePopover.events}
      x={activePopover.x}
      y={activePopover.y}
      above={activePopover.above}
    />
  {/if}
</div>

<style>
  .timeline-view {
    display: flex;
    flex-direction: column;
  }

  .timeline-head {
    display: flex;
    align-items: center;
    gap: var(--space-small);
    margin-bottom: var(--space-small);
  }

  .timeline-title {
    font-size: var(--font-medium);
    font-weight: 600;
  }

  .timeline-count {
    padding: 0 var(--space-small);
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    line-height: 1.5;
  }

  .view-toggle {
    display: inline-flex;
    gap: var(--space-small);
    margin-left: auto;
  }

  .view {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.9rem;
    height: 1.8rem;
    padding: 0;
    border: none;
    border-radius: var(--m3-shape-full);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    cursor: pointer;
  }

  .view:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .view.active {
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }
</style>
