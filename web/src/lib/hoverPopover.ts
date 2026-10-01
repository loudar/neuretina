const EDGE = 8;
const GAP = 6;

/** Anchors whose hidden popover is shown on hover/focus. */
const ANCHOR_SELECTOR = ".cite-anchor, .timeline-anchor";
/** Popovers either nested in the anchor (citations) or next to it (timeline). */
const POPOVER_SELECTOR = ":scope > .cite-popover, :scope > .timeline-popover";

function popoverFor(anchor: HTMLElement): HTMLElement | null {
  const sibling = anchor.nextElementSibling;
  if (sibling instanceof HTMLElement && sibling.matches(".cite-popover, .timeline-popover")) {
    return sibling;
  }
  return anchor.querySelector<HTMLElement>(POPOVER_SELECTOR);
}

function boundsFor(anchor: HTMLElement): DOMRect {
  const container = anchor.closest<HTMLElement>(".pane .body, .drawer-body");
  if (container) return container.getBoundingClientRect();
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/**
 * Clamps hover popovers (citations, timeline events) into their pane: below the
 * anchor when there is room, above it otherwise. Re-runs on scroll and resize.
 */
export function mountHoverPopovers(): () => void {
  let active: HTMLElement | null = null;

  function position(): void {
    const anchor = active;
    if (!anchor) return;
    const popover = popoverFor(anchor);
    if (!popover) return;

    const bounds = boundsFor(anchor);
    const anchorRect = anchor.getBoundingClientRect();

    popover.style.position = "fixed";
    popover.style.maxWidth = "";
    const available = Math.max(0, bounds.width - EDGE * 2);
    if (available > 0 && popover.offsetWidth > available) {
      popover.style.maxWidth = `${available}px`;
    }

    const width = popover.offsetWidth;
    const height = popover.offsetHeight;

    const minLeft = bounds.left + EDGE;
    const maxLeft = Math.max(minLeft, bounds.right - width - EDGE);
    const left = Math.min(Math.max(anchorRect.left, minLeft), maxLeft);

    const minTop = bounds.top + EDGE;
    const maxTop = Math.max(minTop, bounds.bottom - height - EDGE);
    const below = anchorRect.bottom + GAP;
    const above = anchorRect.top - height - GAP;
    const preferred = below <= maxTop ? below : above;
    const top = Math.min(Math.max(preferred, minTop), maxTop);

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
  }

  function activate(target: EventTarget | null): void {
    const anchor =
      target instanceof Element ? target.closest<HTMLElement>(ANCHOR_SELECTOR) : null;
    if (!anchor || !popoverFor(anchor)) {
      active = null;
      return;
    }
    active = anchor;
    position();
  }

  function refresh(): void {
    if (active && (active.matches(":hover") || active.matches(":focus-within"))) position();
  }

  const onPointerOver = (event: PointerEvent) => activate(event.target);
  const onFocusIn = (event: FocusEvent) => activate(event.target);
  const onScroll = () => refresh();
  const onResize = () => refresh();

  document.addEventListener("pointerover", onPointerOver, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  return () => {
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
  };
}
