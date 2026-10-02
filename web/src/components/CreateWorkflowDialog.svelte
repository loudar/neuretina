<script lang="ts">
  import { Button, Dialog } from "m3-svelte";
  import type { Topic, WorkflowInfo } from "../lib/api";
  import { commands } from "../lib/commands";
  import { reportError, reportSuccess } from "../lib/feedback";
  import WorkflowForm from "./WorkflowForm.svelte";

  interface Props {
    open: boolean;
    /** Definition new workflows are created from. */
    template: WorkflowInfo | undefined;
    onsaved: (id: string) => void;
  }

  let { open = $bindable(), template, onsaved }: Props = $props();

  let topics = $state<Topic[]>([]);
  let name = $state("");
  let inputs = $state<Record<string, string[]>>({});
  let saving = $state(false);

  const canSave = $derived(
    !saving &&
      name.trim() !== "" &&
      (template?.inputs ?? []).every(
        (spec) => !spec.required || (inputs[spec.id]?.length ?? 0) > 0,
      ),
  );

  // Reset the form and load topics each time the dialog opens.
  $effect(() => {
    if (!open) return;
    name = "";
    inputs = {};
    void commands.topics
      .list()
      .then((loaded) => (topics = loaded))
      .catch(reportError);
  });

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      const created = await commands.userWorkflows.create({
        name: name.trim(),
        inputs: { ...inputs },
      });
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
    <WorkflowForm
      bind:name
      bind:inputs
      specs={template?.inputs ?? []}
      {topics}
      disabled={saving}
      onenter={() => void save()}
    />
  </div>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
    <Button variant="filled" onclick={() => void save()} disabled={!canSave}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .workflow-form {
    width: min(24rem, 100%);
  }
</style>
