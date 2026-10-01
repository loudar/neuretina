<script lang="ts">
  import { Switch, TextFieldOutlined } from "m3-svelte";
  import type { Topic, WorkflowInputInfo } from "../lib/api";

  interface Props {
    name: string;
    /** Configured values keyed by input id, e.g. `{ topics: ["…"] }`. */
    inputs: Record<string, string[]>;
    /** The workflow's input specs, rendered by kind. */
    specs: WorkflowInputInfo[];
    topics: Topic[];
    disabled?: boolean;
    /** Cap the topic list with its own scrollbar (dialog); the details tab grows. */
    capped?: boolean;
    /** Triggered by Enter in the name field. */
    onenter?: () => void;
  }

  let {
    name = $bindable(),
    inputs = $bindable(),
    specs,
    topics,
    disabled = false,
    capped = true,
    onenter,
  }: Props = $props();

  function valuesOf(spec: WorkflowInputInfo): string[] {
    return inputs[spec.id] ?? [];
  }

  function toggleTopic(spec: WorkflowInputInfo, id: string): void {
    const current = valuesOf(spec);
    inputs = {
      ...inputs,
      [spec.id]: current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    };
  }
</script>

<div class="workflow-fields">
  <TextFieldOutlined label="Name" bind:value={name} {disabled} enter={onenter} />

  {#each specs as spec (spec.id)}
    <div class="field-group">
      <h3 class="group-label">{spec.title}</h3>
      {#if spec.kind === "topics"}
        {#if topics.length === 0}
          <p class="muted">No topics yet. Create topics first, then pick the ones to cover.</p>
        {:else}
          <div class="toggle-list" class:capped>
            {#each topics as topic (topic.id)}
              <label class="toggle-row" class:muted={topic.muted}>
                <Switch
                  checked={valuesOf(spec).includes(topic.id)}
                  {disabled}
                  onchange={() => toggleTopic(spec, topic.id)}
                />
                <span>{topic.name}{topic.muted ? " (muted)" : ""}</span>
              </label>
            {/each}
          </div>
        {/if}
      {:else}
        <p class="muted">This input kind is not editable in the interface yet.</p>
      {/if}
      {#if spec.description}
        <p class="muted spec-note">{spec.description}</p>
      {/if}
    </div>
  {/each}
</div>

<style>
  .workflow-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
  }

  .group-label {
    @apply --m3-title-small;
    color: var(--m3c-on-surface-variant);
  }

  .toggle-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
    padding: 0;
  }

  .toggle-list.capped {
    max-height: 12rem;
    overflow-y: auto;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: var(--space-small);
    padding: 0 0;
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
    cursor: pointer;
    user-select: none;
  }

  .toggle-row.muted {
    opacity: 0.65;
  }

  .spec-note {
    font-size: var(--font-medium);
  }
</style>
