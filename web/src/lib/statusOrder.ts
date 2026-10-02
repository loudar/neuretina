import type { StatusEntry } from "./statusTypes";

export interface OrderedStatusEntry extends StatusEntry {
  /** 0 = top-level, 1+ = nested under its parent entry. */
  depth: number;
  children: OrderedStatusEntry[];
}

/**
 * Feed order with nesting: strictly chronological (top to bottom by start
 * time, ties by id), with any entry carrying a `parentId` nested under its
 * parent. Running and settled entries stay in execution order.
 */
export function orderStatusEntries(entries: StatusEntry[]): OrderedStatusEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const childMap = new Map<string, StatusEntry[]>();
  const roots: StatusEntry[] = [];

  for (const entry of entries) {
    const parent = entry.parentId ? byId.get(entry.parentId) : undefined;
    if (!parent || parent.id === entry.id) {
      roots.push(entry);
      continue;
    }
    const siblings = childMap.get(parent.id) ?? [];
    siblings.push(entry);
    childMap.set(parent.id, siblings);
  }

  const build = (entry: StatusEntry, depth: number): OrderedStatusEntry => ({
    ...entry,
    depth,
    children: sortChildren(childMap.get(entry.id) ?? []).map((child) => build(child, depth + 1)),
  });

  return sortRoots(roots).map((root) => build(root, 0));
}

/** Depth-first flattening (parents before their children). */
export function flattenStatusEntries(entries: OrderedStatusEntry[]): OrderedStatusEntry[] {
  return entries.flatMap((entry) => [entry, ...flattenStatusEntries(entry.children)]);
}

/** Strictly chronological: earliest start first, ties by id. */
function sortRoots(entries: StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}

function sortChildren(entries: StatusEntry[]): StatusEntry[] {
  return [...entries].sort((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id));
}
