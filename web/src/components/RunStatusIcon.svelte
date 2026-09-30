<script lang="ts">
  import { CircularProgressEstimate, Icon } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconSkip from "@ktibow/iconset-material-symbols/skip-next";
  import type { WorkflowRunStatus } from "../lib/api";

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
          : "done",
  );
</script>

<span class="status {status}" title={label} aria-label={label}>
  {#if status === "running"}
    <CircularProgressEstimate {size} thickness={2} />
  {:else if status === "failed"}
    <Icon icon={iconError} {size} />
  {:else if status === "skipped"}
    <Icon icon={iconSkip} {size} />
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
    color: light-dark(#1f6f36, #a9d9b4);
  }

  .status.failed {
    color: var(--m3c-error);
  }

  .status.skipped {
    color: var(--m3c-on-surface-variant);
  }
</style>
