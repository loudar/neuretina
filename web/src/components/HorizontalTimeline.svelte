<script lang="ts">
  import type { TimelineEvent } from "../lib/api";
  import {
    HORIZONTAL_LABEL_PX,
    HORIZONTAL_SLOT_PX,
    groupTimelineEvents,
    horizontalAxisLength,
    horizontalPosition,
    horizontalTimelineWidth,
    timelineLabelEntries,
    timelineLabelLines,
    timelineScale,
    type TimelineLabelEntry,
  } from "../lib/timeline";
  import TimelineLabels from "./TimelineLabels.svelte";

  interface Props {
    events: TimelineEvent[];
    activeKey?: string;
    popoverId: string;
    onopen: (event: MouseEvent | FocusEvent, entry: TimelineLabelEntry) => void;
    onclose: () => void;
  }

  let { events, activeKey, popoverId, onopen, onclose }: Props = $props();

  const LABEL_LINE_REM = 1.35;

  let measuredWidth = $state(0);

  const scale = $derived(timelineScale(events));
  const contentWidth = $derived(horizontalTimelineWidth(scale.marks.length, measuredWidth));
  const groups = $derived(
    groupTimelineEvents(events, {
      length: horizontalAxisLength(contentWidth),
      // A hair under a full slot: marks one slot apart must not merge.
      minGap: HORIZONTAL_SLOT_PX - 4,
    }),
  );
  const maxLines = $derived(
    groups.reduce((max, group) => Math.max(max, timelineLabelLines(group)), 1),
  );
  const height = $derived(2.95 + maxLines * LABEL_LINE_REM);

  /** Maps a 0..1 time position onto the horizontal track. */
  function offset(position: number): string {
    return `${(horizontalPosition(position, contentWidth) * 100).toFixed(3)}%`;
  }
</script>

<!-- The track can be wider than the box; scroll instead of squeezing markers
     until titles are unreadable. -->
<div class="hscroll" bind:clientWidth={measuredWidth} onscroll={onclose}>
  <div
    class="track horizontal"
    style:width={`${contentWidth}px`}
    style:height={`${height.toFixed(2)}rem`}
    style:--label-width={`${HORIZONTAL_LABEL_PX}px`}
  >
    <span class="axis" aria-hidden="true"></span>

    {#each scale.marks as mark (mark.key)}
      <span class="scale" style:--at={offset(mark.position)}>
        <span class="scale-tick" aria-hidden="true"></span>
        <span class="scale-label">{mark.label}</span>
      </span>
    {/each}

    {#each groups as group (group.key)}
      <div class="marker" style:--at={offset(group.position)}>
        <span class="tick" class:multi={group.events.length > 1} aria-hidden="true"></span>
        <TimelineLabels
          entries={timelineLabelEntries(group)}
          variant="horizontal"
          {activeKey}
          {popoverId}
          {onopen}
          {onclose}
        />
      </div>
    {/each}
  </div>
</div>

<style>
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
</style>
