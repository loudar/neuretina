<script lang="ts">
  import type { Snippet } from "svelte";

  interface Props {
    title?: string;
    subtitle?: string;
    /** List panes are fixed-width; detail panes fill the rest. */
    variant?: "list" | "detail";
    /** Width of a list pane (CSS length). */
    width?: string;
    actions?: Snippet;
    children: Snippet;
  }

  let {
    title,
    subtitle,
    variant = "detail",
    width = "22rem",
    actions,
    children,
  }: Props = $props();
</script>

<section class="pane {variant}" style:width={variant === "list" ? width : undefined}>
  {#if title}
    <header class="head">
      <div class="titles">
        <h2>{title}</h2>
        {#if subtitle}<small class="muted">{subtitle}</small>{/if}
      </div>
      {#if actions}
        <div class="head-actions">{@render actions()}</div>
      {/if}
    </header>
  {/if}

  <div class="body">
    {@render children()}
  </div>
</section>

<style>
  .pane {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .pane.list {
    flex: none;
    width: 22rem;
    background-color: var(--m3c-surface-container-low);
    border-inline-end: 1px solid var(--m3c-outline-variant);
  }

  .pane.detail {
    flex: 1 1 auto;
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.9rem 1rem 0.65rem;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    min-width: 0;
  }

  .titles h2 {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .titles small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1rem;
  }

  .pane.list .body {
    padding: 0.5rem 0.75rem 1.5rem;
  }
</style>
