import type { StatusEntry } from "./statusTypes";

/**
 * Feed order: settled (dimmed) history on top, all currently running entries
 * grouped at the bottom so parallel tasks always stay together.
 *
 * - settled entries are ordered by when they settled (oldest first)
 * - running entries are ordered by when they started — stable, so frequent
 *   status updates never reshuffle them
 */
export function sortStatusEntries(entries: StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => {
    const aRunning = a.state === "running" ? 1 : 0;
    const bRunning = b.state === "running" ? 1 : 0;
    if (aRunning !== bRunning) return aRunning - bRunning;

    const aKey = aRunning === 1 ? a.startedAt : a.updatedAt;
    const bKey = bRunning === 1 ? b.startedAt : b.updatedAt;
    return aKey - bKey || a.startedAt - b.startedAt;
  });
}
