import { onMount } from "svelte";
import { eventStream } from "./events.svelte";

/**
 * Runs `refresh` once on mount and again whenever an incoming event matches
 * one of the given topics. A pattern ending in "." is treated as a prefix
 * (e.g. "job."), anything else must match exactly.
 */
export function useRefresh(patterns: string[], refresh: () => unknown): void {
  const matches = (topic: string): boolean =>
    patterns.some((pattern) =>
      pattern.endsWith(".") ? topic.startsWith(pattern) : topic === pattern,
    );

  onMount(() => {
    void refresh();
  });

  $effect(() => {
    const topic = eventStream.events.at(-1)?.topic ?? "";
    if (matches(topic)) void refresh();
  });
}
