<script lang="ts">
  import {
    Button,
    Dialog,
    Icon,
    ListItem,
    Switch,
    TextFieldOutlined,
    TextFieldOutlinedMultiline,
  } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconVisibility from "@ktibow/iconset-material-symbols/visibility";
  import iconVisibilityOff from "@ktibow/iconset-material-symbols/visibility-off";
  import { commands, type Topic } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";

  let topics = $state<Topic[]>([]);
  let name = $state("");
  let description = $state("");
  let busy = $state(false);

  let editName = $state("");
  let editDescription = $state("");
  let saving = $state(false);
  let togglingId = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  const route = $derived(router.current);
  const topicId = $derived(route.segments[0] ?? null);
  const selected = $derived(topics.find((topic) => topic.id === topicId) ?? null);

  // Seed the edit fields when a different topic is opened; a background
  // refresh of the list must not clobber unsaved edits.
  let editedTopicId: string | null = null;
  $effect(() => {
    if (!selected) {
      editedTopicId = null;
      return;
    }
    if (editedTopicId === selected.id) return;
    editedTopicId = selected.id;
    editName = selected.name;
    editDescription = selected.description ?? "";
  });

  async function refresh(): Promise<void> {
    try {
      topics = await commands.topics.list();
      if (topicId && !topics.some((topic) => topic.id === topicId)) {
        router.navigate(paths.topics(), { replace: true });
      }
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

  async function save(): Promise<void> {
    if (!selected || !editName.trim() || saving) return;
    saving = true;
    try {
      await commands.topics.update(selected.id, {
        name: editName.trim(),
        description: editDescription.trim(),
      });
      reportSuccess("Topic updated");
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
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

  async function remove(): Promise<void> {
    if (!selected || deleting) return;
    const target = selected;
    deleting = true;
    router.navigate(paths.topics());
    try {
      await commands.topics.remove(target.id);
      confirmingDelete = false;
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }
</script>

<Pane variant="list" title="Topics">
  <div class="add-form">
    <TextFieldOutlined label="New topic" bind:value={name} enter={add} />
    <TextFieldOutlinedMultiline label="Context (optional)" rows={2} bind:value={description} />
    <Button variant="filled" iconType="left" onclick={add} disabled={busy || !name.trim()}>
      <Icon icon={iconAdd} /> Add topic
    </Button>
  </div>

  <DataList items={topics} empty="No topics yet. Add the things you want to keep an eye on.">
    {#snippet children(topic)}
      <div class="entry" class:selected={topicId === topic.id} class:muted={topic.muted}>
        <ListItem
          onclick={() => router.navigate(paths.topics(topic.id))}
          headline={topic.name}
          supporting={`${topic.description ?? "no context"}${topic.muted ? " · muted" : ""}`}
        >
          {#snippet leading()}
            <Icon icon={topic.muted ? iconVisibilityOff : iconLabel} />
          {/snippet}
          {#snippet trailing()}
            <label
              class="inline-toggle"
              title={topic.muted
                ? "Excluded from briefings — turn on to include"
                : "Included in briefings — turn off to exclude"}
              onclick={(event) => event.stopPropagation()}
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
          {/snippet}
        </ListItem>
      </div>
    {/snippet}
  </DataList>
</Pane>

<Pane variant="detail" title={selected?.name ?? "Topic details"}>
  {#snippet actions()}
    {#if selected}
      <label
        class="inline-toggle"
        title={selected.muted
          ? "Excluded from briefings — turn on to include"
          : "Included in briefings — turn off to exclude"}
      >
        <Switch
          checked={!selected.muted}
          icons="both"
          checkedIcon={iconVisibility}
          uncheckedIcon={iconVisibilityOff}
          onchange={() => toggleMute(selected)}
          disabled={togglingId === selected.id}
        />
        <span class="toggle-label">{selected.muted ? "Excluded" : "Included"}</span>
      </label>
      <span class="danger">
        <Button
          variant="text"
          iconType="full"
          onclick={() => (confirmingDelete = true)}
          disabled={deleting}
        >
          <Icon icon={iconDelete} />
        </Button>
      </span>
    {/if}
  {/snippet}

  {#if selected}
    <div class="detail-form">
      <TextFieldOutlined label="Topic" bind:value={editName} enter={save} />
      <TextFieldOutlinedMultiline label="Context (optional)" rows={4} bind:value={editDescription} />
      <div class="actions">
        <Button variant="filled" onclick={save} disabled={saving || !editName.trim()}>
          Save changes
        </Button>
      </div>
    </div>
  {:else}
    <p class="muted">Select a topic to edit it, or add a new one on the left.</p>
  {/if}
</Pane>

<ConfirmDeleteDialog
  bind:open={confirmingDelete}
  headline="Delete this topic?"
  message={`"${selected?.name}" will be permanently removed. Existing briefs are kept. This cannot be undone.`}
  busy={deleting}
  onconfirm={remove}
  oncancel={() => (confirmingDelete = false)}
/>

<style>
  .entry.muted {
    opacity: 0.65;
  }

</style>
