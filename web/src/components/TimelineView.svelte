<script lang="ts">
  import { Icon } from "m3-svelte";
  import iconViewStream from "@ktibow/iconset-material-symbols/view-stream";
  import iconViewWeek from "@ktibow/iconset-material-symbols/view-week";
  import { commands } from "../lib/commands";
  import type { ArtifactInfo, TimelineEvent } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import {
    HORIZONTAL_LABEL_PX,
    HORIZONTAL_SLOT_PX,
    formatEventDay,
    formatEventWhen,
    groupTimelineDays,
    groupTimelineEvents,
    horizontalAxisLength,
    horizontalPosition,
    horizontalTimelineWidth,
    timelineScale,
  } from "../lib/timeline";
  import { timelinePrefs, type TimelineOrientation } from "../lib/timeline.svelte";

  interface Props {
    artifact: ArtifactInfo;
    /** Preloaded events (anonymous share view); otherwise loaded over the session. */
    events?: TimelineEvent[];
  }

  let { artifact, events: preloadedEvents }: Props = $props();

  const tooltipPrefix = crypto.randomUUID();

  /** Up to this many titles show per marker; the rest collapse into one row. */
  const MAX_STACKED = 2;
  const LABEL_LINE_REM = 1.35;

  let fetchedEvents = $state<TimelineEvent[] | null>(null);
  let loading = $state(preloadedEvents === undefined);
  let measuredWidth = $state(0);

  const events = $derived(preloadedEvents ?? fetchedEvents);

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
  function openPopover(event: MouseEvent | FocusEvent, entry: LabelEntry): void {
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
    if (preloadedEvents !== undefined) {
      loading = false;
      return;
    }
    const ids = eventIds;
    fetchedEvents = null;
    loading = true;
    if (ids.length === 0) {
      loading = false;
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

  interface LabelGroup {
    key: string;
    events: TimelineEvent[];
  }

  /** At most two titles per marker; anything beyond becomes one "+n more…" row. */
  function labelEntries(group: LabelGroup): LabelEntry[] {
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

  function labelLines(group: LabelGroup): number {
    return Math.min(group.events.length, MAX_STACKED + 1);
  }

  const orientation = $derived(timelinePrefs.orientation);
  const dayGroups = $derived(groupTimelineDays(events ?? []));
  const scale = $derived(timelineScale(events ?? []));

  const contentWidth = $derived(horizontalTimelineWidth(scale.marks.length, measuredWidth));
  const horizontalGroups = $derived(
    groupTimelineEvents(events ?? [], {
      length: horizontalAxisLength(contentWidth),
      // A hair under a full slot: marks one slot apart must not merge.
      minGap: HORIZONTAL_SLOT_PX - 4,
    }),
  );
  const maxLines = $derived(
    horizontalGroups.reduce((max, group) => Math.max(max, labelLines(group)), 1),
  );
  const horizontalHeight = $derived(2.95 + maxLines * LABEL_LINE_REM);

  /** Maps a 0..1 time position onto the horizontal track. */
  function offset(position: number): string {
    return `${(horizontalPosition(position, contentWidth) * 100).toFixed(3)}%`;
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

{#snippet labelList(entries: LabelEntry[])}
  <span class="labels">
    {#each entries as entry (entry.key)}
      <button
        type="button"
        class="timeline-anchor"
        class:more={entry.more}
        aria-describedby={activePopover?.key === entry.key ? `${tooltipPrefix}-popover` : undefined}
        onmouseenter={(event) => openPopover(event, entry)}
        onmouseleave={closePopover}
        onfocus={(event) => openPopover(event, entry)}
        onblur={closePopover}
      >
        {entry.label}
      </button>
    {/each}
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
  {:else if dayGroups.length === 0}
    <p class="muted">No events in this timeline.</p>
  {:else if orientation === "horizontal"}
    <div class="hscroll" bind:clientWidth={measuredWidth} onscroll={closePopover}>
      <div
        class="track horizontal"
        style:width={`${contentWidth}px`}
        style:height={`${horizontalHeight.toFixed(2)}rem`}
        style:--label-width={`${HORIZONTAL_LABEL_PX}px`}
      >
        <span class="axis" aria-hidden="true"></span>

        {#each scale.marks as mark (mark.key)}
          <span class="scale" style:--at={offset(mark.position)}>
            <span class="scale-tick" aria-hidden="true"></span>
            <span class="scale-label">{mark.label}</span>
          </span>
        {/each}

        {#each horizontalGroups as group (group.key)}
          <div class="marker" style:--at={offset(group.position)}>
            <span class="tick" class:multi={group.events.length > 1} aria-hidden="true"></span>
            {@render labelList(labelEntries(group))}
          </div>
        {/each}
      </div>
    </div>
  {:else}
    <div class="track vertical">
      <span class="axis" aria-hidden="true"></span>
      {#each dayGroups as day (day.key)}
        <div class="day">
          <span class="day-when">{formatEventDay(day.events[0]!)}</span>
          <span class="day-tick" class:multi={day.events.length > 1} aria-hidden="true"></span>
          {@render labelList(labelEntries(day))}
        </div>
      {/each}
    </div>
  {/if}

  {#if activePopover}
    <div
      class="timeline-popover"
      class:above={activePopover.above}
      role="tooltip"
      id={`${tooltipPrefix}-popover`}
      style:left={`${activePopover.x}px`}
      style:top={`${activePopover.y}px`}
    >
      {#each activePopover.events as event (event.id)}
        {@render eventDetails(event)}
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

  /* The horizontal track can be wider than the box; scroll instead of squeezing
     markers until titles are unreadable. */
  .hscroll {
    overflow-x: auto;
    overflow-y: hidden;
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

  /* Vertical layout: days stack in a stream, so the shortest distance between
     two events is the flex gap below. */
  .track.vertical {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
  }

  .day {
    position: relative;
    display: flex;
    align-items: flex-start;
  }

  .day-when {
    flex: none;
    box-sizing: border-box;
    width: 4.5rem;
    padding-right: 0.75rem;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-small);
    line-height: calc(var(--font-medium) * 1.4);
    text-align: right;
    white-space: nowrap;
  }

  .day-tick {
    position: absolute;
    left: 4.5rem;
    top: calc(var(--font-medium) * 0.7);
    width: 1.25rem;
    height: 2px;
    transform: translate(-0.35rem, -50%);
    background-color: var(--m3c-outline);
  }

  .day-tick.multi {
    background-color: var(--m3c-primary);
  }

  .day .labels {
    flex: 1 1 auto;
    min-width: 0;
    padding-left: 1.15rem;
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
    bottom: 0.85rem;
    transform: translateX(-50%);
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

  .tick.multi {
    background-color: var(--m3c-primary);
  }

  /* Titles: left-aligned, stacked under each other, starting at the tick. */
  .labels {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-small);
  }

  .track.horizontal .labels {
    position: absolute;
    top: 0.55rem;
    width: var(--label-width);
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
    display: flex;
    position: fixed;
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

  .timeline-popover.above {
    transform: translateY(-100%);
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
