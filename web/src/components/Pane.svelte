<script lang="ts">
  import type { Snippet } from "svelte";
  import { untrack } from "svelte";
  import {
    SIDEBAR_DEFAULT_WIDTH_REM,
    SIDEBAR_MAX_WIDTH_REM,
    SIDEBAR_MIN_WIDTH_REM,
    claimSidebarIndex,
    clearSidebarWidth,
    readSidebarWidth,
    writeSidebarWidth,
  } from "../lib/sidebarWidths.svelte";

  interface Props {
    title?: string;
    subtitle?: string;
    /** List panes are fixed-width; detail panes fill the rest. */
    variant?: "list" | "detail";
    /** Allow the pane width to be dragged. Defaults to list panes. */
    resizable?: boolean;
    actions?: Snippet;
    children: Snippet;
  }

  let {
    title,
    subtitle,
    variant = "detail",
    resizable = variant === "list",
    actions,
    children,
  }: Props = $props();

  // List panes claim a position when they mount, so the same sidebar position
  // keeps the same width in every tab. `variant` never changes for a pane.
  const sidebarIndex = untrack(() => (variant === "list" ? claimSidebarIndex() : null));

  function rootFontSize(): number {
    const parsed = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  }

  function clampWidth(value: number, rootSize = rootFontSize()): number {
    return Math.min(Math.max(value, SIDEBAR_MIN_WIDTH_REM * rootSize), SIDEBAR_MAX_WIDTH_REM * rootSize);
  }

  function defaultWidth(rootSize = rootFontSize()): number {
    return clampWidth(SIDEBAR_DEFAULT_WIDTH_REM * rootSize, rootSize);
  }

  function initialWidth(): number {
    const stored = sidebarIndex === null ? null : readSidebarWidth(sidebarIndex);
    return stored === null ? defaultWidth() : clampWidth(stored);
  }

  const canResize = $derived(resizable && variant === "list");

  let currentWidth = $state(initialWidth());
  let dragging = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  $effect(() => {
    if (!dragging) return;
    const previous = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = previous;
    };
  });

  function persistWidth(): void {
    if (sidebarIndex === null) return;
    writeSidebarWidth(sidebarIndex, currentWidth);
  }

  function startResize(event: PointerEvent): void {
    dragStartX = event.clientX;
    dragStartWidth = currentWidth;
    dragging = true;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
  }

  function onMove(event: PointerEvent): void {
    if (!dragging) return;
    currentWidth = clampWidth(dragStartWidth + (event.clientX - dragStartX));
  }

  function endResize(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    persistWidth();
  }

  function resetWidth(): void {
    currentWidth = defaultWidth();
    if (sidebarIndex === null) return;
    clearSidebarWidth(sidebarIndex);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    currentWidth = clampWidth(currentWidth + (event.key === "ArrowLeft" ? -16 : 16));
    persistWidth();
  }
</script>

<section
  class="pane {variant}"
  class:resizable={canResize}
  class:dragging
  style:width={variant === "list" ? `${currentWidth}px` : undefined}
>
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

  {#if canResize}
    <div
      class="resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      onpointerdown={startResize}
      onpointermove={onMove}
      onpointerup={endResize}
      ondblclick={resetWidth}
      tabindex="0"
      onkeydown={onKeydown}
    ></div>
  {/if}
</section>

<style>
  .pane {
    position: relative;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .pane.resizable {
    /* Let the resize handle straddle the pane edge. */
    overflow: visible;
  }

  .pane.dragging {
    user-select: none;
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
    gap: var(--space-medium);
    height: 3.5rem;
    flex: none;
    padding: 0 var(--space-large);
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .titles {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-small);
    min-width: 0;
  }

  .titles h2 {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .titles small {
    font-size: 0.72rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: var(--space-small);
    flex-shrink: 0;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: var(--space-large);
  }

  .pane.list .body {
    padding: var(--space-small) var(--space-medium) var(--space-large);
  }

  .resizer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: -3px;
    width: 6px;
    cursor: col-resize;
    background-color: var(--m3c-primary);
    opacity: 0;
    touch-action: none;
    z-index: 1;
  }

  .resizer:hover,
  .resizer:active,
  .resizer:focus-visible {
    opacity: 0.5;
  }
</style>
