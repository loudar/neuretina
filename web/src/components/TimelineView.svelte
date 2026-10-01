<script lang="ts">
  import { Icon } from "m3-svelte";
  import iconViewStream from "@ktibow/iconset-material-symbols/view-stream";
  import iconViewWeek from "@ktibow/iconset-material-symbols/view-week";
  import { commands, type ArtifactInfo, type TimelineEvent } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import { formatEventWhen, groupTimelineEvents, timelineScale } from "../lib/timeline";
  import { timelinePrefs, type TimelineOrientation } from "../lib/timeline.svelte";

  interface Props {
    artifact: ArtifactInfo;
  }

  let { artifact }: Props = $props();

  const tooltipPrefix = crypto.randomUUID();

  /** Titles below the axis are as wide as their label, so keep them apart. */
  const HORIZONTAL_MARKER_GAP_PX = 168;
  const VERTICAL_MARKER_GAP_PX = 88;

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

  const orientation = $derived(timelinePrefs.orientation);
  const trackLength = $derived(orientation === "horizontal" ? measuredWidth : measuredHeight);
  /** Space kept free at both ends so the outer labels are not clipped. */
  const edgeInset = $derived(
    trackLength > 0
      ? orientation === "horizontal"
        ? Math.min(trackLength * 0.4, 84)
        : Math.min(trackLength * 0.2, 14)
      : 0,
  );
  const axisLength = $derived(Math.max(0, trackLength - edgeInset * 2));
  const markerGap = $derived(
    orientation === "horizontal" ? HORIZONTAL_MARKER_GAP_PX : VERTICAL_MARKER_GAP_PX,
  );
  const groups = $derived(
    groupTimelineEvents(events ?? [], { length: axisLength, minGap: markerGap }),
  );
  const scale = $derived(timelineScale(events ?? []));
  const verticalHeight = $derived(
    Math.min(900, Math.max(320, (events?.length ?? 0) * 44 + 96)),
  );

  /** Maps a 0..1 position onto the track, clear of both edges. */
  function offset(position: number): string {
    if (trackLength <= 0 || edgeInset <= 0) return `${(5 + position * 90).toFixed(3)}%`;
    const pixels = edgeInset + position * axisLength;
    return `${((pixels / trackLength) * 100).toFixed(3)}%`;
  }

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
  {:else if groups.length === 0}
    <p class="muted">No events in this timeline.</p>
  {:else}
    <div
      class="track {orientation}"
      style:height={orientation === "vertical" ? `${verticalHeight}px` : undefined}
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
        <div class="marker" style:--at={offset(group.position)}>
          <span class="tick" class:multi={group.events.length > 1} aria-hidden="true"></span>
          <button
            type="button"
            class="timeline-anchor"
            aria-describedby={`${tooltipPrefix}-${index}`}
          >
            <span class="label" class:multi={group.events.length > 1}>
              {group.events.length === 1 ? group.events[0]?.title : `${group.events.length} events`}
            </span>
          </button>
          <span class="timeline-popover" role="tooltip" id={`${tooltipPrefix}-${index}`}>
            {#each group.events as event (event.id)}
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
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .timeline-title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .timeline-count {
    padding: 0.05rem 0.5rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .view-toggle {
    display: inline-flex;
    gap: 0.1rem;
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

  .track.horizontal {
    height: 6.5rem;
  }

  .axis {
    position: absolute;
    background-color: var(--m3c-outline-variant);
  }

  .track.horizontal .axis {
    left: 0;
    right: 0;
    top: 42%;
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
    top: 42%;
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
    font-size: 0.68rem;
    line-height: 1.3;
  }

  /* Event markers. No z-index here: it would trap the popover below later
     markers; the popover needs to sit above everything. */
  .marker {
    position: absolute;
  }

  .track.horizontal .marker {
    top: 42%;
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

  .timeline-anchor {
    position: absolute;
    display: inline-flex;
    align-items: center;
    margin: 0;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--m3c-on-surface);
    font: inherit;
    cursor: help;
  }

  .track.horizontal .timeline-anchor {
    left: 0;
    top: 0.6rem;
    max-width: 9.5rem;
    transform: translateX(-50%);
  }

  .track.vertical .timeline-anchor {
    left: 1.15rem;
    top: 0;
    max-width: calc(100% - 1.35rem);
    transform: translateY(-50%);
  }

  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.84rem;
    line-height: 1.4;
  }

  .label.multi {
    font-weight: 600;
  }

  .timeline-anchor:hover .label {
    text-decoration: underline dotted;
    text-decoration-color: var(--m3c-primary);
    text-underline-offset: 0.22em;
  }

  .timeline-anchor:focus-visible {
    outline: 2px solid var(--m3c-primary);
    outline-offset: 2px;
    border-radius: 2px;
  }

  /* The popover is a sibling of the anchor: the anchor is transformed to
     center it, and a transform would capture position: fixed children. */
  .timeline-popover {
    display: none;
    position: absolute;
    top: calc(100% + 0.4rem);
    left: 0;
    z-index: 90;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 15rem;
    max-width: min(28rem, 80vw);
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background-color: var(--m3c-surface-container-high);
    box-shadow: var(--m3-elevation-3);
    color: var(--m3c-on-surface);
    font-size: 0.85rem;
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
    gap: 0.2rem;
  }

  .popover-event + .popover-event {
    margin-top: 0.45rem;
    padding-top: 0.45rem;
    border-top: 1px solid var(--m3c-outline-variant);
  }

  .popover-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .popover-title {
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.35;
  }

  .popover-when {
    flex: none;
    color: var(--m3c-on-surface-variant);
    font-size: 0.72rem;
    white-space: nowrap;
  }

  .popover-description {
    color: var(--m3c-on-surface-variant);
    font-size: 0.83rem;
    white-space: pre-wrap;
  }

  .popover-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
    margin-top: 0.1rem;
  }
</style>
