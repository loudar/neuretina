<script lang="ts">
  import { Button, Dialog, TextFieldOutlined } from "m3-svelte";
  import { commands } from "../lib/commands";
  import { reportError, reportSuccess } from "../lib/feedback";

  interface Props {
    open: boolean;
    onsaved: (id: string) => void;
  }

  let { open = $bindable(), onsaved }: Props = $props();

  let name = $state("");
  let saving = $state(false);

  const canSave = $derived(!saving && name.trim() !== "");

  // Topics and other inputs are configured later in the details editor.
  $effect(() => {
    if (!open) return;
    name = "";
  });

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      const created = await commands.userWorkflows.create({ name: name.trim(), inputs: {} });
      reportSuccess("Workflow saved");
      open = false;
      onsaved(created.id);
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog headline="New workflow" bind:open>
  <div class="workflow-form">
    <TextFieldOutlined label="Name" bind:value={name} enter={() => void save()} />
  </div>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
    <Button variant="filled" onclick={() => void save()} disabled={!canSave}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .workflow-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
  }
</style>
