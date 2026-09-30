<script lang="ts">
  import { Switch, TextFieldOutlined } from "m3-svelte";
  import type { DeliveryChannelInfo, DeliveryChannelType, Topic } from "../lib/api";

  interface Props {
    name: string;
    topicIds: string[];
    channelIds: string[];
    topics: Topic[];
    channels: DeliveryChannelInfo[];
    disabled?: boolean;
    /** Cap the topic/channel lists with their own scrollbar (dialogs). */
    capped?: boolean;
    /** Triggered by Enter in the name field. */
    onenter?: () => void;
  }

  let {
    name = $bindable(),
    topicIds = $bindable(),
    channelIds = $bindable(),
    topics,
    channels,
    disabled = false,
    capped = true,
    onenter,
  }: Props = $props();

  const TYPE_LABELS: Record<DeliveryChannelType, string> = {
    matrix: "Matrix",
    discord: "Discord",
    email: "Email",
  };

  function toggleTopic(id: string): void {
    topicIds = topicIds.includes(id)
      ? topicIds.filter((entry) => entry !== id)
      : [...topicIds, id];
  }

  function toggleChannel(id: string): void {
    channelIds = channelIds.includes(id)
      ? channelIds.filter((entry) => entry !== id)
      : [...channelIds, id];
  }
</script>

<div class="workflow-fields">
  <TextFieldOutlined label="Name" bind:value={name} {disabled} enter={onenter} />

  <div class="field-group">
    <h3 class="group-label">Topics</h3>
    {#if topics.length === 0}
      <p class="muted">No topics yet. Create topics first, then pick the ones to cover.</p>
    {:else}
      <div class="toggle-list" class:capped>
        {#each topics as topic (topic.id)}
          <label class="toggle-row" class:muted={topic.muted}>
            <Switch
              checked={topicIds.includes(topic.id)}
              {disabled}
              onchange={() => toggleTopic(topic.id)}
            />
            <span>{topic.name}{topic.muted ? " (muted)" : ""}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>

  <div class="field-group">
    <h3 class="group-label">Delivery channels</h3>
    {#if channels.length === 0}
      <p class="muted">No delivery channels yet.</p>
    {:else}
      <div class="toggle-list" class:capped>
        {#each channels as channel (channel.id)}
          <label class="toggle-row">
            <Switch
              checked={channelIds.includes(channel.id)}
              {disabled}
              onchange={() => toggleChannel(channel.id)}
            />
            <span>{channel.name}</span>
            <span class="provider-tag">{TYPE_LABELS[channel.type]}</span>
          </label>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .workflow-fields {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .group-label {
    @apply --m3-title-small;
    color: var(--m3c-on-surface-variant);
  }

  .toggle-list {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.1rem;
  }

  .toggle-list.capped {
    max-height: 12rem;
    overflow-y: auto;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.15rem 0;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .toggle-row.muted {
    opacity: 0.65;
  }
</style>
