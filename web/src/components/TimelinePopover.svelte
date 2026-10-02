<script lang="ts">
  import type { TimelineEvent } from "../lib/api";
  import { formatEventWhen } from "../lib/timeline";

  interface Props {
    id: string;
    events: TimelineEvent[];
    /** Viewport coordinates; fixed-positioned so scroll boxes cannot clip it. */
    x: number;
    y: number;
    above: boolean;
  }

  let { id, events, x, y, above }: Props = $props();
</script>

<div
  class="timeline-popover"
  class:above
  role="tooltip"
  {id}
  style:left={`${x}px`}
  style:top={`${y}px`}
>
  {#each events as event (event.id)}
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
</div>

<style>
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
