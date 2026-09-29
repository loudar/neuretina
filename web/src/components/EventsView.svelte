<script lang="ts">
  import { Button, TextFieldOutlined } from "m3-svelte";
  import { eventStream } from "../lib/events.svelte";
  import type { DomainEvent } from "../lib/api";
  import Pane from "./Pane.svelte";

  let filter = $state("");
  let selectedId = $state<string | null>(null);

  const filtered = $derived(
    [...eventStream.events]
      .reverse()
      .filter((event) => event.topic.toLowerCase().includes(filter.toLowerCase())),
  );

  const selected = $derived(
    eventStream.events.find((event) => event.id === selectedId) ?? null,
  );

  function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString();
  }
</script>

<Pane variant="list" title="Live events">
  {#snippet actions()}
    <Button variant="text" onclick={() => eventStream.clear()}>Clear</Button>
  {/snippet}

  <div class="filter">
    <TextFieldOutlined label="Filter by topic" bind:value={filter} />
  </div>

  {#if filtered.length === 0}
    <p class="muted">No events yet.</p>
  {:else}
    <div class="event-list">
      {#each filtered as event (event.id)}
        <button
          type="button"
          class="event"
          class:selected={selectedId === event.id}
          onclick={() => (selectedId = event.id)}
        >
          <span class="time">{formatTime(event.ts)}</span>
          <span class="topic">{event.topic}</span>
        </button>
      {/each}
    </div>
  {/if}
</Pane>

<Pane
  variant="detail"
  title={selected?.topic ?? "Event details"}
  subtitle={selected ? `${formatTime(selected.ts)} · ${selected.source}` : undefined}
>
  {#if selected}
    <div class="facts">
      <div class="fact">
        <span class="label">Seq</span>
        <span>{selected.seq}</span>
      </div>
      <div class="fact">
        <span class="label">Source</span>
        <span>{selected.source}</span>
      </div>
      <div class="fact">
        <span class="label">Correlation</span>
        <span>{selected.correlationId ?? "–"}</span>
      </div>
    </div>
    <h3 class="subhead">Payload</h3>
    <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
  {:else}
    <p class="muted">Select an event to inspect its payload.</p>
  {/if}
</Pane>

<style>
  .filter {
    padding: 0.25rem 0.25rem 0.6rem;
  }

  .event-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .event {
    display: flex;
    gap: 0.75rem;
    align-items: baseline;
    width: 100%;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: var(--m3-shape-small);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .event:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .event.selected {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .time {
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .event.selected .time {
    color: inherit;
    opacity: 0.8;
  }

  .topic {
    font-size: 0.85rem;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .facts {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-width: 48rem;
  }

  .fact {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    font-size: 0.9rem;
  }

  .fact .label {
    min-width: 6.5rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.8rem;
  }

  .subhead {
    margin: 1.25rem 0 0.5rem;
  }

  pre {
    margin: 0;
    padding: 0.75rem;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-low);
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
    max-width: 48rem;
  }
</style>
