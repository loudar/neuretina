import { router } from "./router.svelte";

/** Default width for sidebars (list panes), in rem. */
export const SIDEBAR_DEFAULT_WIDTH_REM = 22;
export const SIDEBAR_MIN_WIDTH_REM = 13;
export const SIDEBAR_MAX_WIDTH_REM = 40;

const STORAGE_PREFIX = "briefing.sidebar.";

// Sidebars persist per position: the first sidebar in every tab shares one
// width, the second shares another, and so on. The counter is reset when the
// tab changes because each tab mounts its own layout.
let layoutTab: string | null = null;
let nextIndex = 0;

/** Position of the next sidebar pane in the current tab's layout. */
export function claimSidebarIndex(): number {
  const { tab } = router.current;
  if (tab !== layoutTab) {
    layoutTab = tab;
    nextIndex = 0;
  }
  return nextIndex++;
}

export function readSidebarWidth(index: number): number | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${index}`);
    const parsed = raw === null ? Number.NaN : Number.parseFloat(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeSidebarWidth(index: number, width: number): void {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${index}`, String(Math.round(width)));
  } catch {}
}

export function clearSidebarWidth(index: number): void {
  try {
    localStorage.removeItem(`${STORAGE_PREFIX}${index}`);
  } catch {}
}
