<script lang="ts">
  import { Button, Dialog } from "m3-svelte";

  interface Props {
    open: boolean;
    headline: string;
    message: string;
    /** Label of the destructive button (e.g. "Reset" instead of "Delete"). */
    confirmLabel?: string;
    busy?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
  }

  let {
    open = $bindable(),
    headline,
    message,
    confirmLabel = "Delete",
    busy = false,
    onconfirm,
    oncancel,
  }: Props = $props();
</script>

<Dialog {headline} bind:open>
  <p>{message}</p>
  {#snippet buttons()}
    <Button variant="text" onclick={oncancel} disabled={busy}>Cancel</Button>
    <span class="danger">
      <Button variant="filled" onclick={onconfirm} disabled={busy}>{confirmLabel}</Button>
    </span>
  {/snippet}
</Dialog>
