<script lang="ts">
  interface Props {
    groups: string[];
    active: string | null;
    onjump: (group: string) => void;
  }

  let { groups, active, onjump }: Props = $props();
</script>

<!-- Absolutely placed inside the reserved left padding, so it can never
     overlap the settings content; the inner nav sticks while its full-height
     slot scrolls past. -->
<div class="nav-slot">
  <nav class="nav" aria-label="Settings sections">
    {#each groups as group (group)}
      <button
        type="button"
        class="nav-item"
        class:active={active === group}
        onclick={() => onjump(group)}
      >
        {group}
      </button>
    {/each}
  </nav>
</div>

<style>
  .nav-slot {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 12rem;
  }

  .nav {
    position: sticky;
    top: 0;
    box-sizing: border-box;
    width: 12rem;
    display: flex;
    flex-direction: column;
    /* Same gap on both sides of the nav. */
    padding-right: var(--space-large);
  }

  .nav-item {
    display: block;
    width: 100%;
    padding: var(--space-medium) var(--space-medium);
    border: none;
    border-radius: var(--m3-shape-small);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    font: inherit;
    font-size: var(--font-medium);
    line-height: 1.35;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .nav-item:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .nav-item.active {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  @media (max-width: 720px) {
    .nav-slot {
      position: static;
      width: 100%;
    }

    .nav {
      position: static;
      width: 100%;
      flex-direction: row;
      flex-wrap: wrap;
      padding: 0 0 var(--space-medium);
    }

    .nav-item {
      width: auto;
    }
  }
</style>
