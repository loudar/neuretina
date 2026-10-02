<script lang="ts">
  import { Button, Dialog } from "m3-svelte";
  import type { WorkflowRunDetail } from "../lib/api";

  interface Props {
    open: boolean;
    run: WorkflowRunDetail | null;
    busy: boolean;
    onconfirm: (withArtifacts: boolean) => void;
  }

  let { open = $bindable(), run, busy, onconfirm }: Props = $props();
</script>

<Dialog headline="Delete this run?" bind:open>
  <p>
    Run {run?.id.slice(0, 8)} ({run?.workflow}) will be removed from the history.
    {#if (run?.artifacts.length ?? 0) > 0}
      Delete the {run?.artifacts.length} artifact(s) it produced as well? Artifacts that are kept
      stay available in the Artifacts tab.
    {:else}
      It produced no artifacts.
    {/if}
  </p>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={busy}>Cancel</Button>
    <span class="danger">
      <Button variant="text" onclick={() => onconfirm(false)} disabled={busy}>Keep artifacts</Button>
    </span>
    <span class="danger">
      <Button variant="filled" onclick={() => onconfirm(true)} disabled={busy}>
        Delete artifacts too
      </Button>
    </span>
  {/snippet}
</Dialog>
