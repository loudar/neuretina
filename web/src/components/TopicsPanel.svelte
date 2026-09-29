<script lang="ts">
  import {
    Button,
    Icon,
    ListItem,
    Switch,
    TextFieldOutlined,
    TextFieldOutlinedMultiline,
  } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconCheck from "@ktibow/iconset-material-symbols/check";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconEdit from "@ktibow/iconset-material-symbols/edit";
  import iconVisibility from "@ktibow/iconset-material-symbols/visibility";
  import iconVisibilityOff from "@ktibow/iconset-material-symbols/visibility-off";
  import { commands, type Topic } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Panel from "./Panel.svelte";

  let topics = $state<Topic[]>([]);
  let name = $state("");
  let description = $state("");
  let busy = $state(false);

  let editingId = $state<string | null>(null);
  let editName = $state("");
  let editDescription = $state("");
  let saving = $state(false);
  let togglingId = $state<string | null>(null);

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
      if (editingId === id) editingId = null;
      await commands.topics.remove(id);
    } catch (error) {
      reportError(error);
    }
  }

  async function toggleMute(topic: Topic): Promise<void> {
    if (togglingId) return;
    togglingId = topic.id;
    try {
      const updated = await commands.topics.update(topic.id, { muted: !topic.muted });
      reportSuccess(
        updated.muted
          ? `"${updated.name}" excluded from briefings`
          : `"${updated.name}" included in briefings`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      togglingId = null;
    }
  }

  function startEdit(topic: Topic): void {
    editingId = topic.id;
    editName = topic.name;
    editDescription = topic.description ?? "";
  }

  function cancelEdit(): void {
    editingId = null;
  }

  async function saveEdit(): Promise<void> {
    if (!editingId || !editName.trim() || saving) return;
    saving = true;
    try {
      await commands.topics.update(editingId, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      editingId = null;
      reportSuccess("Topic updated");
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }
</script>

<Panel>
  <h2>Topics of interest</h2>
  <p class="muted">
    The briefing agent researches each topic on the web and on Bluesky, then compiles a neutral
    brief grouped by topic.
  </p>

  <div class="actions">
    <TextFieldOutlined label="Topic" bind:value={name} enter={add} />
    <div class="context-field">
      <TextFieldOutlinedMultiline
        label="Context (optional)"
        rows={2}
        bind:value={description}
      />
    </div>
    <Button variant="filled" iconType="left" onclick={add} disabled={busy || !name.trim()}>
      <Icon icon={iconAdd} /> Add topic
    </Button>
  </div>

  <DataList items={topics} empty="No topics yet. Add the things you want to keep an eye on.">
    {#snippet children(topic)}
      {#if editingId === topic.id}
        <div class="actions edit-row">
          <TextFieldOutlined label="Topic" bind:value={editName} enter={saveEdit} />
          <div class="context-field">
            <TextFieldOutlinedMultiline
              label="Context (optional)"
              rows={2}
              bind:value={editDescription}
            />
          </div>
          <Button
            variant="filled"
            iconType="left"
            onclick={saveEdit}
            disabled={saving || !editName.trim()}
          >
            <Icon icon={iconCheck} /> Save
          </Button>
          <Button variant="text" onclick={cancelEdit} disabled={saving}>Cancel</Button>
        </div>
      {:else}
        <div class="entry" class:muted={topic.muted}>
          <ListItem
            headline={topic.name}
            supporting={`${topic.description ?? "no context"}${topic.muted ? " · muted" : ""}`}
          >
            {#snippet trailing()}
              <div class="actions">
                <label
                  class="include-toggle"
                  title={topic.muted
                    ? "Excluded from briefings — turn on to include"
                    : "Included in briefings — turn off to exclude"}
                >
                  <Switch
                    checked={!topic.muted}
                    icons="both"
                    checkedIcon={iconVisibility}
                    uncheckedIcon={iconVisibilityOff}
                    onchange={() => toggleMute(topic)}
                    disabled={togglingId === topic.id}
                  />
                </label>
                <Button variant="text" iconType="full" onclick={() => startEdit(topic)}>
                  <Icon icon={iconEdit} />
                </Button>
                <Button variant="text" iconType="full" onclick={() => remove(topic.id)}>
                  <Icon icon={iconDelete} />
                </Button>
              </div>
            {/snippet}
          </ListItem>
        </div>
      {/if}
    {/snippet}
  </DataList>
</Panel>

<style>
  .edit-row {
    padding-block: 0.25rem;
  }

  .entry {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    border-radius: var(--m3-shape-medium);
  }

  .entry.muted {
    opacity: 0.6;
  }

  .include-toggle {
    display: flex;
    align-items: center;
  }

  .context-field {
    flex: 1 1 20rem;
    min-width: 15rem;
    display: flex;
  }

  .context-field > :global(.m3-container) {
    flex: 1;
  }
</style>
