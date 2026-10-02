<script lang="ts">
  import { Button, Icon, Switch } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconCopy from "@ktibow/iconset-material-symbols/content-copy";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconEdit from "@ktibow/iconset-material-symbols/edit";
  import { commands } from "../lib/commands";
  import type { DeliveryChannelInfo } from "../lib/api";
  import {
    DELIVERY_TYPE_ICONS,
    DELIVERY_TYPE_LABELS,
    configSummary,
  } from "../lib/delivery";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import DataList from "./DataList.svelte";
  import DeliveryChannelDialog from "./DeliveryChannelDialog.svelte";
  import Pane from "./Pane.svelte";

  let channels = $state<DeliveryChannelInfo[]>([]);
  let toggling = $state<string | null>(null);
  let testing = $state<string | null>(null);
  let deleting = $state(false);
  let confirmingDelete = $state(false);
  let deleteTarget = $state<DeliveryChannelInfo | null>(null);

  let dialogOpen = $state(false);
  let editChannel = $state<DeliveryChannelInfo | null>(null);
  let duplicateChannel = $state<DeliveryChannelInfo | null>(null);

  async function refresh(): Promise<void> {
    try {
      channels = await commands.delivery.channels();
    } catch (error) {
      reportError(error);
    }
  }

  // The delivery backend may still be coming up; failures stay local so the
  // rest of the tab keeps working.
  useRefresh(["delivery."], refresh);

  async function toggleChannel(channel: DeliveryChannelInfo): Promise<void> {
    toggling = channel.id;
    try {
      const updated = await commands.delivery.updateChannel(channel.id, {
        enabled: !channel.enabled,
      });
      channels = channels.map((entry) => (entry.id === updated.id ? updated : entry));
    } catch (error) {
      reportError(error);
    } finally {
      toggling = null;
    }
  }

  async function testChannel(channel: DeliveryChannelInfo): Promise<void> {
    testing = channel.id;
    try {
      const result = await commands.delivery.verifyChannel(channel.id);
      if (result.ok) reportSuccess(`${channel.name} verified: ${result.detail}`);
      else reportError(`${channel.name}: ${result.detail}`);
    } catch (error) {
      reportError(error);
    } finally {
      testing = null;
    }
  }

  function openAdd(): void {
    editChannel = null;
    duplicateChannel = null;
    dialogOpen = true;
  }

  function openEdit(channel: DeliveryChannelInfo): void {
    editChannel = channel;
    duplicateChannel = null;
    dialogOpen = true;
  }

  function openDuplicate(channel: DeliveryChannelInfo): void {
    editChannel = null;
    duplicateChannel = channel;
    dialogOpen = true;
  }

  function onSaved(channel: DeliveryChannelInfo, created: boolean): void {
    channels = created
      ? [...channels, channel]
      : channels.map((entry) => (entry.id === channel.id ? channel : entry));
  }

  async function removeChannel(): Promise<void> {
    const target = deleteTarget;
    if (!target || deleting) return;
    deleting = true;
    try {
      await commands.delivery.removeChannel(target.id);
      channels = channels.filter((channel) => channel.id !== target.id);
      confirmingDelete = false;
      reportSuccess(`Channel "${target.name}" deleted`);
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }
</script>

<Pane variant="detail" title="Delivery">
  {#snippet actions()}
    <Button variant="tonal" iconType="left" onclick={openAdd}>
      <Icon icon={iconAdd} /> Add channel
    </Button>
  {/snippet}

  <p class="muted intro">
    Channels receive the outputs workflow steps produce. A channel is only used while it is
    enabled and assigned to a step output in a workflow's Details tab.
  </p>

  <section class="group">
    <h3>Channels</h3>
    <DataList items={channels} empty="No delivery channels yet.">
      {#snippet children(channel)}
        <article class="row">
          <div class="info">
            <div class="name">
              <Icon icon={DELIVERY_TYPE_ICONS[channel.type]} size={18} />
              <span>{channel.name}</span>
              <span class="provider-tag" data-provider={channel.type}>
                {DELIVERY_TYPE_LABELS[channel.type]}
              </span>
            </div>
            <p class="desc muted">{configSummary(channel) || "Not configured."}</p>
          </div>
          <div class="control">
            <Switch
              checked={channel.enabled}
              title={channel.enabled ? "Disable channel" : "Enable channel"}
              disabled={toggling === channel.id}
              onchange={() => void toggleChannel(channel)}
            />
            <Button
              variant="text"
              title="Send a test message through this channel"
              onclick={() => void testChannel(channel)}
              disabled={testing === channel.id}
            >
              {testing === channel.id ? "Testing…" : "Test"}
            </Button>
            <Button
              variant="text"
              iconType="full"
              title="Duplicate channel into the add form"
              onclick={() => openDuplicate(channel)}
            >
              <Icon icon={iconCopy} />
            </Button>
            <Button variant="text" iconType="full" title="Edit channel" onclick={() => openEdit(channel)}>
              <Icon icon={iconEdit} />
            </Button>
            <span class="danger">
              <Button
                variant="text"
                iconType="full"
                title="Delete channel"
                onclick={() => {
                  deleteTarget = channel;
                  confirmingDelete = true;
                }}
              >
                <Icon icon={iconDelete} />
              </Button>
            </span>
          </div>
        </article>
      {/snippet}
    </DataList>
  </section>

  <DeliveryChannelDialog
    bind:open={dialogOpen}
    channel={editChannel}
    duplicate={duplicateChannel}
    onsaved={onSaved}
  />

  <ConfirmDeleteDialog
    bind:open={confirmingDelete}
    headline="Delete this channel?"
    message={`Channel "${deleteTarget?.name}" (${deleteTarget ? DELIVERY_TYPE_LABELS[deleteTarget.type] : ""}) will be removed and detached from all workflows. This cannot be undone.`}
    busy={deleting}
    onconfirm={() => void removeChannel()}
    oncancel={() => (confirmingDelete = false)}
  />
</Pane>

<style>
  .intro {
    @apply --m3-body-medium;
    margin: 0 0 var(--space-large);
    max-width: 44rem;
  }

  .group {
    max-width: 60rem;
    margin-bottom: var(--space-large);
  }

  .group h3 {
    @apply --m3-title-small;
    margin: 0 0 var(--space-small);
    color: var(--m3c-on-surface-variant);
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-large);
    padding: var(--space-medium) 0;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
    min-width: 0;
    flex: 1 1 auto;
  }

  .name {
    @apply --m3-body-large;
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }

  .desc {
    @apply --m3-body-small;
    margin: 0;
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-small);
    flex: 0 0 auto;
  }
</style>
