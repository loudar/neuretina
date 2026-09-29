<script lang="ts">
  import { Button, TextFieldOutlined } from "m3-svelte";
  import { eventStream } from "../lib/events.svelte";
  import Panel from "./Panel.svelte";

  let filter = $state("");

  const filtered = $derived(
    [...eventStream.events]
      .reverse()
      .filter((event) => event.topic.toLowerCase().includes(filter.toLowerCase())),
  );

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<Panel>
  <div class="toolbar">
    <h2>Live events</h2>
    <div class="actions">
      <TextFieldOutlined label="Filter by topic" bind:value={filter} />
      <Button variant="text" onclick={() => eventStream.clear()}>Clear</Button>
    </div>
  </div>

  <p class="muted">
    Every subsystem publishes to the event bus; this is the persisted stream (seq {eventStream.lastSeq}).
    Fed by webhook <code>event.wait</code> long-polls and resumes automatically after drops.
  </p>

  {#if filtered.length === 0}
    <p class="muted">No events yet.</p>
  {:else}
    <div class="event-list">
      {#each filtered as event (event.id)}
        <div class="event">
          <span class="time">{formatTime(event.ts)}</span>
          <span class="topic">{event.topic}</span>
          <details>
            <summary>
              {event.correlationId ? `correlation ${event.correlationId.slice(0, 8)} · ` : ""}payload
            </summary>
            <pre>{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        </div>
      {/each}
    </div>
  {/if}
</Panel>

<style>
  .event-list {
    max-height: 34rem;
    overflow: auto;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-small);
  }

  .event {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    padding: 0.4rem 0.6rem;
    border-bottom: 1px solid var(--m3c-outline-variant);
    background: var(--m3c-surface-container-low);
  }

  .event:last-child {
    border-bottom: none;
  }

  .time {
    @apply --m3-label-medium;
    color: var(--m3c-on-surface-variant);
    white-space: nowrap;
  }

  .topic {
    @apply --m3-label-large;
    color: var(--m3c-primary);
    white-space: nowrap;
    min-width: 12rem;
  }

  details {
    flex: 1;
    min-width: 0;
  }

  summary {
    cursor: pointer;
    color: var(--m3c-on-surface-variant);
  }

  pre {
    @apply --m3-body-small;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0.4rem 0 0.2rem;
  }
</style>
