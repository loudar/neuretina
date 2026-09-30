<script lang="ts">
  import { Icon } from "m3-svelte";
  import iconBlock from "@ktibow/iconset-material-symbols/block";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconSkip from "@ktibow/iconset-material-symbols/skip-next";
  import type { WorkflowRunStatus } from "../lib/api";
  import PulseDot from "./PulseDot.svelte";

  interface Props {
    status: WorkflowRunStatus;
    size?: number;
  }

  let { status, size = 18 }: Props = $props();

  const label = $derived(
    status === "running"
      ? "running"
      : status === "failed"
        ? "failed"
        : status === "skipped"
          ? "skipped"
          : status === "cancelled"
            ? "cancelled"
            : "done",
  );
</script>

<span class="status {status}" title={label} aria-label={label}>
  {#if status === "running"}
    <PulseDot size={Math.round(size * 0.55)} />
  {:else if status === "failed"}
    <Icon icon={iconError} {size} />
  {:else if status === "skipped"}
    <Icon icon={iconSkip} {size} />
  {:else if status === "cancelled"}
    <Icon icon={iconBlock} {size} />
  {:else}
    <Icon icon={iconCheck} {size} />
  {/if}
</span>

<style>
  .status {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .status.running {
    color: var(--m3c-primary);
  }

  .status.succeeded {
    color: var(--m3c-success);
  }

  .status.failed {
    color: var(--m3c-error);
  }

  .status.skipped {
    color: var(--m3c-on-surface-variant);
  }

  .status.cancelled {
    color: var(--m3c-on-surface-variant);
  }
</style>
