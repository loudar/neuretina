<script lang="ts">
  import type { Snippet } from "svelte";
  import { Icon } from "m3-svelte";
  import iconWarning from "@ktibow/iconset-material-symbols/warning";

  interface Props {
    label: string;
    description?: string;
    /** Muted line under the label (e.g. the active connection summary). */
    source?: string;
    /** Shows the environment-override warning next to the label. */
    overridden?: boolean;
    overrideTitle?: string;
    /** The row's controls. */
    children: Snippet;
  }

  let { label, description, source, overridden = false, overrideTitle, children }: Props = $props();
</script>

<article class="setting">
  <div class="info">
    <div class="name">
      <span>{label}</span>
      {#if overridden}
        <span class="override" title={overrideTitle}>
          <Icon icon={iconWarning} size={16} />
        </span>
      {/if}
    </div>
    {#if description}
      <p class="desc muted">{description}</p>
    {/if}
    {#if source}
      <span class="source">{source}</span>
    {/if}
  </div>
  <div class="control">{@render children()}</div>
</article>

<style>
  .setting {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-large);
    padding: var(--space-medium) 0;
  }

  .info {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1 1 auto;
  }

  .name {
    @apply --m3-body-large;
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }

  .override {
    display: inline-flex;
    color: var(--m3c-warning);
    cursor: help;
  }

  .desc {
    @apply --m3-body-small;
    margin: 0;
  }

  .source {
    @apply --m3-label-medium;
    color: var(--m3c-on-surface-variant);
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-small);
    flex: 0 0 auto;
  }
</style>
