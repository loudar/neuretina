<script lang="ts">
  import type { TimelineLabelEntry } from "../lib/timeline";

  interface Props {
    entries: TimelineLabelEntry[];
    /** Layout the labels belong to; drives their positioning. */
    variant: "horizontal" | "vertical";
    /** Entry whose popover is currently open. */
    activeKey?: string;
    /** Id of the shared popover, for `aria-describedby`. */
    popoverId: string;
    onopen: (event: MouseEvent | FocusEvent, entry: TimelineLabelEntry) => void;
    onclose: () => void;
  }

  let { entries, variant, activeKey, popoverId, onopen, onclose }: Props = $props();
</script>

<span class="labels" class:horizontal={variant === "horizontal"} class:vertical={variant === "vertical"}>
  {#each entries as entry (entry.key)}
    <button
      type="button"
      class="timeline-anchor"
      class:more={entry.more}
      aria-describedby={activeKey === entry.key ? popoverId : undefined}
      onmouseenter={(event) => onopen(event, entry)}
      onmouseleave={onclose}
      onfocus={(event) => onopen(event, entry)}
      onblur={onclose}
    >
      {entry.label}
    </button>
  {/each}
</span>

<style>
  .labels {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-small);
  }

  /* Below a horizontal marker, in a fixed-width column. */
  .labels.horizontal {
    position: absolute;
    top: 0.55rem;
    width: var(--label-width);
  }

  /* Right of a vertical day tick. */
  .labels.vertical {
    flex: 1 1 auto;
    min-width: 0;
    padding-left: 1.15rem;
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
</style>
