import { onMount } from "svelte";
import { eventStream } from "./events.svelte";
import { scanNewEvents } from "./eventMatch";

/**
 * Runs `refresh` once on mount and again whenever an incoming event batch
 * contains an event matching one of the given topics. Prefixes end in "."
 * (e.g. "job."); everything else matches exactly.
 */
export function useRefresh(patterns: string[], refresh: () => unknown): void {
  // Events already buffered at component init are covered by the initial refresh.
  let seenSeq = eventStream.events.at(-1)?.seq ?? 0;

  onMount(() => {
    void refresh();
  });

  $effect(() => {
    const scan = scanNewEvents(eventStream.events, patterns, seenSeq);
    seenSeq = scan.seenSeq;
    if (scan.matched) void refresh();
  });
}
