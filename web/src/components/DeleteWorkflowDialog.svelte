<script lang="ts">
  import { Button, Dialog } from "m3-svelte";
  import type { WorkflowInfo } from "../lib/api";
  import { workflowHeadline } from "../lib/workflows";

  interface Props {
    open: boolean;
    workflow: WorkflowInfo | null;
    /** True when deleting a customized built-in workflow resets it instead. */
    resetting: boolean;
    busy: boolean;
    onconfirm: () => void;
  }

  let { open = $bindable(), workflow, resetting, busy, onconfirm }: Props = $props();
</script>

<Dialog headline={resetting ? "Reset this workflow?" : "Delete this workflow?"} bind:open>
  <p>
    {#if resetting}
      Reset "{workflow?.id}" to its defaults? The custom name and topic selection are removed;
      delivery channels and scheduled tasks are kept.
    {:else}
      "{workflow ? workflowHeadline(workflow) : ""}" will be permanently removed and its attached
      delivery channels are detached. Scheduled tasks that still use this workflow must be removed
      first. This cannot be undone.
    {/if}
  </p>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
    <span class="danger">
      <Button variant="filled" onclick={onconfirm} disabled={busy}>
        {resetting ? "Reset" : "Delete"}
      </Button>
    </span>
  {/snippet}
</Dialog>
