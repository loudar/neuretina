<script lang="ts">
  import type { TimelineEvent } from "../lib/api";
  import {
    formatEventDay,
    groupTimelineDays,
    timelineLabelEntries,
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

  const dayGroups = $derived(groupTimelineDays(events));
</script>

<!-- Days stack in a stream, so the shortest distance between two events is the
     flex gap below. -->
<div class="track vertical">
  <span class="axis" aria-hidden="true"></span>
  {#each dayGroups as day (day.key)}
    <div class="day">
      <span class="day-when">{formatEventDay(day.events[0]!)}</span>
      <span class="day-tick" class:multi={day.events.length > 1} aria-hidden="true"></span>
      <TimelineLabels
        entries={timelineLabelEntries(day)}
        variant="vertical"
        {activeKey}
        {popoverId}
        {onopen}
        {onclose}
      />
    </div>
  {/each}
</div>

<style>
  .track {
    position: relative;
    width: 100%;
  }

  .track.vertical {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
  }

  .axis {
    position: absolute;
    background-color: var(--m3c-outline-variant);
  }

  .track.vertical .axis {
    left: 4.5rem;
    top: 0;
    bottom: 0;
    width: 2px;
    transform: translateX(-50%);
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
</style>
