<script lang="ts">
  import { Button, Icon, ListItem, TextFieldOutlined } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import { commands, type Topic } from "../lib/api";
  import { reportError } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Panel from "./Panel.svelte";

  let topics = $state<Topic[]>([]);
  let name = $state("");
  let description = $state("");
  let busy = $state(false);

  async function refresh(): Promise<void> {
    try {
      topics = await commands.topics.list();
    } catch (error) {
      reportError(error);
    }
  }

  useRefresh(["topic."], refresh);

  async function add(): Promise<void> {
    if (!name.trim() || busy) return;
    busy = true;
    try {
      await commands.topics.create({
        name: name.trim(),
        description: description.trim() || undefined,
      });
      name = "";
      description = "";
    } catch (error) {
      reportError(error);
    } finally {
      busy = false;
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await commands.topics.remove(id);
    } catch (error) {
      reportError(error);
    }
  }
</script>

<Panel>
  <h2>Topics of interest</h2>

  <div class="actions">
    <TextFieldOutlined label="Topic" bind:value={name} enter={add} />
    <TextFieldOutlined label="Context (optional)" bind:value={description} enter={add} />
    <Button variant="filled" iconType="left" onclick={add} disabled={busy || !name.trim()}>
      <Icon icon={iconAdd} /> Add topic
    </Button>
  </div>

  <DataList items={topics} empty="No topics yet. Add the things you want to keep an eye on.">
    {#snippet children(topic)}
      <ListItem headline={topic.name} supporting={topic.description ?? "no context"}>
        {#snippet trailing()}
          <Button variant="text" iconType="full" onclick={() => remove(topic.id)}>
            <Icon icon={iconDelete} />
          </Button>
        {/snippet}
      </ListItem>
    {/snippet}
  </DataList>
</Panel>
