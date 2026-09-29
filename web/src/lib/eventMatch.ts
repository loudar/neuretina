import type { DomainEvent } from "./api";

/** A pattern ending in "." is a prefix match (e.g. "job."); anything else must match exactly. */
export function matchesPatterns(patterns: string[], topic: string): boolean {
  return patterns.some((pattern) =>
    pattern.endsWith(".") ? topic.startsWith(pattern) : topic === pattern,
  );
}

export interface EventScan {
  /** Highest sequence number inspected. */
  seenSeq: number;
  /** Whether any event newer than `sinceSeq` matched one of the patterns. */
  matched: boolean;
}

/**
 * Scans the (batched) event buffer for events newer than `sinceSeq`.
 * Batches may mix events from several subsystems, so every event is checked —
 * not just the last one.
 */
export function scanNewEvents(
  events: DomainEvent[],
  patterns: string[],
  sinceSeq: number,
): EventScan {
  let seenSeq = sinceSeq;
  let matched = false;

  for (const event of events) {
    if (event.seq <= seenSeq) continue;
    seenSeq = event.seq;
    if (!matched && matchesPatterns(patterns, event.topic)) matched = true;
  }

  return { seenSeq, matched };
}
