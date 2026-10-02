<script lang="ts">
  import { Button, Icon, ListItem, Select } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import type { WorkflowInfo } from "../lib/api";
  import { workflowHeadline, workflowOverline } from "../lib/workflows";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";

  interface Props {
    workflows: WorkflowInfo[];
    contextOptions: Array<{ text: string; value: string }>;
    context: string;
    selectedId: string | null;
    oncreate: () => void;
    oncontext: (value: string) => void;
    onopen: (id: string) => void;
    onrun: (id: string) => void;
  }

  let { workflows, contextOptions, context, selectedId, oncreate, oncontext, onopen, onrun }: Props =
    $props();
</script>

<Pane variant="list" title="Workflows">
  {#snippet actions()}
    <Button variant="tonal" iconType="left" title="New workflow" onclick={oncreate}>
      <Icon icon={iconAdd} /> New workflow
    </Button>
  {/snippet}

  <div class="filters">
    <Select
      label="Context"
      options={contextOptions}
      value={context}
      onchange={(event) => oncontext(event.currentTarget.value)}
    />
  </div>

  <DataList items={workflows} empty="No workflows in this context.">
    {#snippet children(workflow)}
      <div class="entry" class:selected={selectedId === workflow.id}>
        <ListItem
          onclick={() => onopen(workflow.id)}
          overline={workflowOverline(workflow)}
          headline={workflowHeadline(workflow)}
          supporting=""
        >
          {#snippet trailing()}
            {#if workflow.triggers.includes("manual")}
              <span class="run-button">
                <Button
                  variant="filled"
                  iconType="full"
                  title="Run now"
                  onclick={() => onrun(workflow.id)}
                >
                  <Icon icon={iconPlay} />
                </Button>
              </span>
            {/if}
          {/snippet}
        </ListItem>
      </div>
    {/snippet}
  </DataList>
</Pane>

<style>
  /* The run action stands out with the tertiary accent color. */
  .run-button {
    display: contents;
    --m3c-primary: var(--m3c-tertiary);
    --m3c-on-primary: var(--m3c-on-tertiary);
  }
</style>
