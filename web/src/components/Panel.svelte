<script lang="ts">
  import { Card } from "m3-svelte";
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<Card variant="outlined">
  <div class="stack">{@render children()}</div>
</Card>
