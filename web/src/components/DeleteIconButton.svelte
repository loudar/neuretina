<script lang="ts">
  import { Button, Icon } from "m3-svelte";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";

  interface Props {
    onclick: () => void;
    disabled?: boolean;
    /** Tooltip; defaults to "Delete". */
    title?: string;
  }

  let { onclick, disabled = false, title = "Delete" }: Props = $props();
</script>

<span class="danger">
  <Button variant="text" iconType="full" {title} {onclick} {disabled}>
    <Icon icon={iconDelete} />
  </Button>
</span>
