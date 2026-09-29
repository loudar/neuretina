import type { StatusEntry } from "./statusTypes";

export interface OrderedStatusEntry extends StatusEntry {
  /** 0 = top-level, 1+ = nested under its parent entry. */
  depth: number;
}

/**
 * Feed order with nesting: settled (dimmed) history on top, all currently
 * running entries grouped at the bottom, and any entry with a `parentId`
 * rendered directly under its parent, one indent level per link. Children
 * keep execution order (start time), not the running/settled split.
 */
export function orderStatusEntries(entries: StatusEntry[]): OrderedStatusEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const children = new Map<string, StatusEntry[]>();
  const roots: StatusEntry[] = [];

  for (const entry of entries) {
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    if (!parent || parent.id === entry.id) {
      roots.push(entry);
      continue;
    }
    const siblings = children.get(parent.id) ?? [];
    siblings.push(entry);
    children.set(parent.id, siblings);
  }

  const ordered: OrderedStatusEntry[] = [];
  const append = (entry: StatusEntry, depth: number) => {
    ordered.push({ ...entry, depth });
    for (const child of sortChildren(children.get(entry.id) ?? [])) append(child, depth + 1);
  };

  for (const root of sortRoots(roots)) append(root, 0);
  return ordered;
}

/** Settled history first (by settle time), running entries last (by start). */
function sortRoots(entries: StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => {
    const aRunning = a.state === "running" ? 1 : 0;
    const bRunning = b.state === "running" ? 1 : 0;
    if (aRunning !== bRunning) return aRunning - bRunning;

    const aKey = aRunning === 1 ? a.startedAt : a.updatedAt;
    const bKey = bRunning === 1 ? b.startedAt : b.updatedAt;
    return aKey - bKey || a.startedAt - b.startedAt;
  });
}

function sortChildren(entries: StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}
