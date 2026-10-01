<script lang="ts">
  import { Icon } from "m3-svelte";
  import iconViewStream from "@ktibow/iconset-material-symbols/view-stream";
  import iconViewWeek from "@ktibow/iconset-material-symbols/view-week";
  import { commands, type ArtifactInfo, type TimelineEvent } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import {
    formatEventWhen,
    groupTimelineEvents,
    timelineScale,
    type TimelineGroup,
  } from "../lib/timeline";
  import { timelinePrefs, type TimelineOrientation } from "../lib/timeline.svelte";

  interface Props {
    artifact: ArtifactInfo;
  }

  let { artifact }: Props = $props();

  const tooltipPrefix = crypto.randomUUID();

  /** Up to this many titles show per marker; the rest collapse into one row. */
  const MAX_STACKED = 3;
  /** Keeps left-aligned titles of neighbouring markers from touching. */
  const HORIZONTAL_MARKER_GAP_PX = 168;
  const VERTICAL_MARKER_GAP_PX = 88;
  const HORIZONTAL_LABEL_PX = 152;
  const LABEL_LINE_REM = 1.35;

  let events = $state<TimelineEvent[] | null>(null);
  let loading = $state(true);
  let measuredWidth = $state(0);
  let measuredHeight = $state(0);

  const eventIds = $derived(
    Array.isArray(artifact.metadata.eventIds)
      ? artifact.metadata.eventIds.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        )
      : [],
  );

  $effect(() => {
    const ids = eventIds;
    events = null;
    loading = true;
    if (ids.length === 0) {
      loading = false;
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await commands.timeline.events(ids);
        if (!cancelled) events = loaded;
      } catch (error) {
        if (!cancelled) reportError(error);
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  interface LabelEntry {
    key: string;
    label: string;
    events: TimelineEvent[];
    /** True for the "+n more…" row that collects the hidden events. */
    more?: boolean;
  }

  /** At most three titles per marker; anything beyond becomes one "+n more…" row. */
  function labelEntries(group: TimelineGroup): LabelEntry[] {
    const entries: LabelEntry[] = group.events.slice(0, MAX_STACKED).map((event) => ({
      key: event.id,
      label: event.title,
      events: [event],
    }));
    const rest = group.events.slice(MAX_STACKED);
    if (rest.length > 0) {
      entries.push({
        key: `${group.key}:more`,
        label: `+${rest.length} more…`,
        events: rest,
        more: true,
      });
    }
    return entries;
  }

  function labelLines(group: TimelineGroup): number {
    return Math.min(group.events.length, MAX_STACKED + 1);
  }

  const orientation = $derived(timelinePrefs.orientation);
  const trackLength = $derived(orientation === "horizontal" ? measuredWidth : measuredHeight);
  const markerGap = $derived(
    orientation === "horizontal" ? HORIZONTAL_MARKER_GAP_PX : VERTICAL_MARKER_GAP_PX,
  );
  const groups = $derived(
    groupTimelineEvents(events ?? [], { length: Math.max(0, trackLength), minGap: markerGap }),
  );
  const scale = $derived(timelineScale(events ?? []));
  const maxLines = $derived(
    groups.reduce((max, group) => Math.max(max, labelLines(group)), 1),
  );

  /** Half of the tallest stacked block has to stay inside the track. */
  const verticalEdge = $derived(4 + maxLines * 10);
  const edgeStart = $derived(orientation === "horizontal" ? 6 : verticalEdge);
  const edgeEnd = $derived(
    orientation === "horizontal"
      ? Math.min(trackLength * 0.5, HORIZONTAL_LABEL_PX + 8)
      : verticalEdge,
  );
  const axisLength = $derived(Math.max(0, trackLength - edgeStart - edgeEnd));
  const horizontalHeight = $derived(2.95 + maxLines * LABEL_LINE_REM);
  const verticalHeight = $derived(
    Math.min(900, Math.max(320, (events?.length ?? 0) * 44 + 96)),
  );

  /** Maps a 0..1 position onto the track, clear of the edges. */
  function offset(position: number): string {
    if (trackLength <= 0 || axisLength <= 0) return `${(position * 100).toFixed(3)}%`;
    return `${(((edgeStart + position * axisLength) / trackLength) * 100).toFixed(3)}%`;
  }

  function setOrientation(next: TimelineOrientation): void {
    timelinePrefs.setOrientation(next);
  }
</script>

{#snippet eventDetails(event: TimelineEvent)}
  <span class="popover-event">
    <span class="popover-head">
      <span class="popover-title">{event.title}</span>
      <span class="popover-when">{formatEventWhen(event)}</span>
    </span>
    {#if event.description}
      <span class="popover-description">{event.description}</span>
    {/if}
    {#if event.tags.length > 0}
      <span class="popover-tags">
        {#each event.tags as tag (tag)}
          <span class="provider-tag">{tag}</span>
        {/each}
      </span>
    {/if}
  </span>
{/snippet}

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
  {:else if groups.length === 0}
    <p class="muted">No events in this timeline.</p>
  {:else}
    <div
      class="track {orientation}"
      style:height={orientation === "horizontal"
        ? `${horizontalHeight.toFixed(2)}rem`
        : `${verticalHeight}px`}
      bind:clientWidth={measuredWidth}
      bind:clientHeight={measuredHeight}
    >
      <span class="axis" aria-hidden="true"></span>

      {#each scale.marks as mark (mark.key)}
        <span class="scale" style:--at={offset(mark.position)}>
          <span class="scale-tick" aria-hidden="true"></span>
          <span class="scale-label">{mark.label}</span>
        </span>
      {/each}

      {#each groups as group, index (group.key)}
        <div
          class="marker"
          style:--at={offset(group.position)}
          style:--lines={labelLines(group)}
        >
          <span class="tick" class:multi={group.events.length > 1} aria-hidden="true"></span>
          <span class="labels">
            {#each labelEntries(group) as entry, entryIndex (entry.key)}
              <button
                type="button"
                class="timeline-anchor"
                class:more={entry.more}
                aria-describedby={`${tooltipPrefix}-${index}-${entryIndex}`}
              >
                {entry.label}
              </button>
              <span
                class="timeline-popover"
                role="tooltip"
                id={`${tooltipPrefix}-${index}-${entryIndex}`}
              >
                {#each entry.events as event (event.id)}
                  {@render eventDetails(event)}
                {/each}
              </span>
            {/each}
          </span>
        </div>
      {/each}
    </div>
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

  .track {
    position: relative;
    width: 100%;
  }

  .axis {
    position: absolute;
    background-color: var(--m3c-outline-variant);
  }

  .track.horizontal .axis {
    left: 0;
    right: 0;
    top: 2rem;
    height: 2px;
    transform: translateY(-50%);
  }

  .track.vertical .axis {
    left: 4.5rem;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
  }

  /* Scale markings sit on the side opposite the event titles. */
  .scale {
    position: absolute;
  }

  .track.horizontal .scale {
    top: 2rem;
    left: var(--at);
    width: 0;
    height: 0;
  }

  .track.horizontal .scale-tick {
    position: absolute;
    left: 0;
    bottom: 0;
    width: 1px;
    height: 0.5rem;
    transform: translateX(-50%);
    background-color: var(--m3c-outline-variant);
  }

  .track.horizontal .scale-label {
    position: absolute;
    left: 0;
    bottom: 0.6rem;
    transform: translateX(-50%);
  }

  .track.vertical .scale {
    top: var(--at);
    left: 0;
    width: 4.5rem;
    height: 0;
  }

  .track.vertical .scale-tick {
    position: absolute;
    right: -0.35rem;
    top: 0;
    width: 0.6rem;
    height: 1px;
    transform: translateY(-50%);
    background-color: var(--m3c-outline-variant);
  }

  .track.vertical .scale-label {
    position: absolute;
    right: 0.75rem;
    top: 0;
    transform: translateY(-50%);
  }

  .scale-label {
    white-space: nowrap;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    line-height: 1.3;
  }

  /* Event markers. No transforms or z-index here: transforms would capture the
     fixed-position popover, a z-index would trap it below later markers. */
  .marker {
    position: absolute;
  }

  .track.horizontal .marker {
    top: 2rem;
    left: var(--at);
    width: 0;
    height: 0;
  }

  .track.vertical .marker {
    top: var(--at);
    left: 4.5rem;
    right: 0;
    height: 0;
  }

  .tick {
    position: absolute;
    background-color: var(--m3c-outline);
  }

  .track.horizontal .tick {
    left: 0;
    top: -0.75rem;
    width: 2px;
    height: 1.1rem;
    transform: translateX(-50%);
  }

  .track.vertical .tick {
    left: -0.35rem;
    top: 0;
    width: 1.25rem;
    height: 2px;
    transform: translateY(-50%);
  }

  .tick.multi {
    background-color: var(--m3c-primary);
  }

  /* Titles: left-aligned, stacked under each other, starting at the tick. */
  .labels {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-small);
  }

  .track.horizontal .labels {
    left: 0.35rem;
    top: 0.55rem;
    width: 9.5rem;
  }

  .track.vertical .labels {
    left: 1.15rem;
    top: calc(var(--lines, 1) * -0.62rem);
    max-width: calc(100% - 1.35rem);
  }

  .timeline-anchor {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--m3c-on-surface);
    font: inherit;
    font-size: var(--font-medium);
    line-height: 1.4;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: help;
  }

  .timeline-anchor.more {
    color: var(--m3c-on-surface-variant);
  }

  .timeline-anchor:hover {
    text-decoration: underline dotted;
    text-decoration-color: var(--m3c-primary);
    text-underline-offset: 0.22em;
  }

  .timeline-anchor:focus-visible {
    outline: 2px solid var(--m3c-primary);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .timeline-popover {
    display: none;
    position: absolute;
    top: calc(100% + 0.4rem);
    left: 0;
    z-index: 90;
    flex-direction: column;
    gap: var(--space-small);
    min-width: 15rem;
    max-width: min(28rem, 80vw);
    padding: var(--space-small) var(--space-medium);
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background-color: var(--m3c-surface-container-high);
    box-shadow: var(--m3-elevation-3);
    color: var(--m3c-on-surface);
    font-size: var(--font-medium);
    font-weight: 400;
    line-height: 1.45;
    text-align: start;
    text-decoration: none;
    white-space: normal;
    cursor: default;
    pointer-events: none;
  }

  .timeline-anchor:hover + .timeline-popover,
  .timeline-anchor:focus-visible + .timeline-popover {
    display: flex;
  }

  .popover-event {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
  }

  .popover-event + .popover-event {
    margin-top: var(--space-small);
    padding-top: var(--space-small);
    border-top: 1px solid var(--m3c-outline-variant);
  }

  .popover-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-small);
  }

  .popover-title {
    font-size: var(--font-medium);
    font-weight: 600;
    line-height: 1.35;
  }

  .popover-when {
    flex: none;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    white-space: nowrap;
  }

  .popover-description {
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
    white-space: pre-wrap;
  }

  .popover-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-large);
    margin-top: 0;
  }
</style>
