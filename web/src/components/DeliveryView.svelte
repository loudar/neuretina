<script lang="ts">
  import { Button, Dialog, Icon, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconChat from "@ktibow/iconset-material-symbols/chat";
  import iconCopy from "@ktibow/iconset-material-symbols/content-copy";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconEdit from "@ktibow/iconset-material-symbols/edit";
  import iconForum from "@ktibow/iconset-material-symbols/forum";
  import iconMail from "@ktibow/iconset-material-symbols/mail";
  import iconVisibility from "@ktibow/iconset-material-symbols/visibility";
  import iconVisibilityOff from "@ktibow/iconset-material-symbols/visibility-off";
  import {
    commands,
    type DeliveryChannelInfo,
    type DeliveryChannelType,
    type DeliveryWorkflowInfo,
    type WorkflowInfo,
  } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { useRefresh } from "../lib/refresh.svelte";
  import DataList from "./DataList.svelte";
  import Pane from "./Pane.svelte";

  let channels = $state<DeliveryChannelInfo[]>([]);
  let workflows = $state<WorkflowInfo[]>([]);
  let deliveryWorkflows = $state<DeliveryWorkflowInfo[]>([]);

  let toggling = $state<string | null>(null);
  let testing = $state<string | null>(null);
  let savingChannel = $state(false);
  let deleting = $state(false);

  let channelDialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let dialogType = $state<DeliveryChannelType>("matrix");
  let confirmingDelete = $state(false);
  let deleteTarget = $state<DeliveryChannelInfo | null>(null);

  interface ChannelForm {
    name: string;
    homeserverUrl: string;
    roomId: string;
    dmUserId: string;
    accessToken: string;
    username: string;
    password: string;
    allowedSenders: string;
    webhookUrl: string;
    host: string;
    port: string;
    secure: boolean;
    from: string;
    to: string;
  }

  const emptyForm: ChannelForm = {
    name: "",
    homeserverUrl: "",
    roomId: "",
    dmUserId: "",
    accessToken: "",
    username: "",
    password: "",
    allowedSenders: "",
    webhookUrl: "",
    host: "",
    port: "587",
    secure: true,
    from: "",
    to: "",
  };

  let form = $state<ChannelForm>({ ...emptyForm });

  let visibleFields = $state<Record<string, boolean>>({});

  function isVisible(field: string): boolean {
    return visibleFields[field] ?? false;
  }

  function passwordType(field: string): "text" | "password" {
    return isVisible(field) ? "text" : "password";
  }

  function passwordTrailing(field: string): {
    icon: typeof iconVisibility;
    title: string;
    onclick: () => void;
  } {
    return {
      icon: isVisible(field) ? iconVisibilityOff : iconVisibility,
      title: isVisible(field) ? "Hide value" : "Show value",
      onclick: () => {
        visibleFields = { ...visibleFields, [field]: !isVisible(field) };
      },
    };
  }

  const TYPE_LABELS: Record<DeliveryChannelType, string> = {
    matrix: "Matrix",
    discord: "Discord",
    email: "Email",
  };

  const TYPE_ICONS: Record<DeliveryChannelType, typeof iconChat> = {
    matrix: iconChat,
    discord: iconForum,
    email: iconMail,
  };

  const typeOptions = [
    { icon: TYPE_ICONS.matrix, text: "Matrix", value: "matrix" },
    { icon: TYPE_ICONS.discord, text: "Discord", value: "discord" },
    { icon: TYPE_ICONS.email, text: "Email", value: "email" },
  ];

  const attachments = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const entry of deliveryWorkflows) map.set(entry.workflow, entry.channelIds);
    return map;
  });

  function isAttached(workflowId: string, channelId: string): boolean {
    return attachments.get(workflowId)?.includes(channelId) ?? false;
  }

  async function refresh(): Promise<void> {
    try {
      channels = await commands.delivery.channels();
    } catch (error) {
      reportError(error);
    }
    try {
      workflows = await commands.workflows.list();
    } catch (error) {
      reportError(error);
    }
    try {
      deliveryWorkflows = await commands.delivery.workflows();
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

  function formFromConfig(channel: DeliveryChannelInfo): ChannelForm {
    const config = channel.config;
    const text = (key: string): string => {
      const value = config[key];
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    };
    return {
      name: channel.name,
      homeserverUrl: text("homeserverUrl"),
      roomId: text("roomId"),
      dmUserId: text("dmUserId"),
      accessToken: text("accessToken"),
      username: text("username"),
      password: text("password"),
      allowedSenders: text("allowedSenders"),
      webhookUrl: text("webhookUrl"),
      host: text("host"),
      port: text("port") || "587",
      secure: config.secure !== false,
      from: text("from"),
      to: text("to"),
    };
  }

  function openAdd(): void {
    editingId = null;
    dialogType = "matrix";
    form = { ...emptyForm };
    channelDialogOpen = true;
  }

  function openEdit(channel: DeliveryChannelInfo): void {
    editingId = channel.id;
    dialogType = channel.type;
    form = formFromConfig(channel);
    channelDialogOpen = true;
  }

  function openDuplicate(channel: DeliveryChannelInfo): void {
    editingId = null;
    dialogType = channel.type;
    form = { ...formFromConfig(channel), name: `${channel.name} (copy)` };
    channelDialogOpen = true;
  }

  const canSaveChannel = $derived.by(() => {
    if (savingChannel || !form.name.trim()) return false;
    if (dialogType === "matrix") {
      return (
        form.homeserverUrl.trim() !== "" &&
        (form.roomId.trim() !== "" || form.dmUserId.trim() !== "")
      );
    }
    if (dialogType === "discord") return form.webhookUrl.trim() !== "";
    return form.host.trim() !== "";
  });

  // Config values are stored as strings; the SMTP port is a number.
  function configFromForm(): Record<string, unknown> {
    if (dialogType === "matrix") {
      return {
        homeserverUrl: form.homeserverUrl.trim(),
        roomId: form.roomId.trim(),
        dmUserId: form.dmUserId.trim(),
        accessToken: form.accessToken.trim(),
        username: form.username.trim(),
        password: form.password.trim(),
        allowedSenders: form.allowedSenders.trim(),
      };
    }
    if (dialogType === "discord") {
      return { webhookUrl: form.webhookUrl.trim() };
    }
    return {
      host: form.host.trim(),
      port: Number(form.port.trim()) || 587,
      secure: form.secure,
      username: form.username.trim(),
      password: form.password.trim(),
      from: form.from.trim(),
      to: form.to.trim(),
    };
  }

  async function saveChannel(): Promise<void> {
    if (!canSaveChannel) return;
    savingChannel = true;
    try {
      const config = configFromForm();
      if (editingId) {
        const updated = await commands.delivery.updateChannel(editingId, {
          name: form.name.trim(),
          config,
        });
        channels = channels.map((entry) => (entry.id === updated.id ? updated : entry));
        reportSuccess(`Channel "${updated.name}" saved`);
      } else {
        const created = await commands.delivery.createChannel({
          type: dialogType,
          name: form.name.trim(),
          config,
        });
        channels = [...channels, created];
        reportSuccess(`Channel "${created.name}" added`);
      }
      channelDialogOpen = false;
    } catch (error) {
      reportError(error);
    } finally {
      savingChannel = false;
    }
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

  async function toggleAttachment(workflowId: string, channelId: string): Promise<void> {
    const attached = isAttached(workflowId, channelId);
    toggling = `${workflowId}:${channelId}`;
    try {
      if (attached) await commands.delivery.detach(workflowId, channelId);
      else await commands.delivery.attach(workflowId, channelId);
      deliveryWorkflows = await commands.delivery.workflows();
    } catch (error) {
      reportError(error);
    } finally {
      toggling = null;
    }
  }

  function configSummary(channel: DeliveryChannelInfo): string {
    const secrets = new Set(["accessToken", "password", "webhookUrl"]);
    const parts: string[] = [];
    for (const [key, value] of Object.entries(channel.config)) {
      if (typeof value === "boolean") {
        parts.push(`${key}: ${value ? "on" : "off"}`);
      } else if (typeof value === "string" && value !== "") {
        parts.push(`${key}: ${secrets.has(key) ? "••••" : value}`);
      } else if (typeof value === "number") {
        parts.push(`${key}: ${String(value)}`);
      }
    }
    return parts.join(" · ");
  }
</script>

<Pane variant="detail" title="Delivery">
  {#snippet actions()}
    <Button variant="tonal" iconType="left" onclick={openAdd}>
      <Icon icon={iconAdd} /> Add channel
    </Button>
  {/snippet}

  <p class="muted intro">
    Channels receive the briefs that workflow runs produce. A channel is only used while it is
    enabled and attached to the workflow below.
  </p>

  <section class="group">
    <h3>Channels</h3>
    <DataList items={channels} empty="No delivery channels yet.">
      {#snippet children(channel)}
        <article class="row">
          <div class="info">
            <div class="name">
              <Icon icon={TYPE_ICONS[channel.type]} size={18} />
              <span>{channel.name}</span>
              <span class="provider-tag" data-provider={channel.type}>
                {TYPE_LABELS[channel.type]}
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

  <section class="group">
    <h3>Workflows</h3>
    <p class="muted desc">
      When a workflow runs and produces a brief, it is delivered to every channel attached here.
    </p>
    <DataList items={workflows} empty="No workflows registered.">
      {#snippet children(workflow)}
        <article class="row">
          <div class="info">
            <div class="name">
              <span>{workflow.id}</span>
            </div>
            <p class="desc muted">{workflow.description}</p>
          </div>
          <div class="control">
            {#if channels.length === 0}
              <span class="muted">No delivery channels yet.</span>
            {:else}
              {#each channels as channel (channel.id)}
                <label
                  class="attach"
                  title={channel.enabled
                    ? `Attach or detach "${channel.name}" for this workflow`
                    : `"${channel.name}" is disabled`}
                >
                  <Switch
                    checked={isAttached(workflow.id, channel.id)}
                    disabled={toggling === `${workflow.id}:${channel.id}`}
                    onchange={() => void toggleAttachment(workflow.id, channel.id)}
                  />
                  <span>{channel.name}{channel.enabled ? "" : " (disabled)"}</span>
                </label>
              {/each}
            {/if}
          </div>
        </article>
      {/snippet}
    </DataList>
  </section>

  <Dialog headline={editingId ? "Edit channel" : "Add channel"} bind:open={channelDialogOpen}>
    <div class="channel-form">
      {#if editingId}
        <div class="type-row">
          <span class="muted">Type</span>
          <span class="provider-tag" data-provider={dialogType}>{TYPE_LABELS[dialogType]}</span>
        </div>
      {:else}
        <Select
          label="Type"
          options={typeOptions}
          value={dialogType}
          onchange={(event) => {
            const value = event.currentTarget.value;
            if (value === "matrix" || value === "discord" || value === "email") dialogType = value;
          }}
        />
      {/if}
      <TextFieldOutlined label="Name" bind:value={form.name} enter={() => void saveChannel()} />
      {#if dialogType === "matrix"}
        <TextFieldOutlined
          label="Homeserver URL"
          bind:value={form.homeserverUrl}
          placeholder="https://matrix.example.org"
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="Room ID"
          bind:value={form.roomId}
          placeholder="!room:matrix.example.org"
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="DM user (Matrix ID)"
          bind:value={form.dmUserId}
          placeholder="@alice:matrix.example.org"
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="Access token"
          type={passwordType("accessToken")}
          autocomplete="off"
          bind:value={form.accessToken}
          enter={() => void saveChannel()}
          trailing={passwordTrailing("accessToken")}
        />
        <TextFieldOutlined
          label="Username"
          autocomplete="off"
          bind:value={form.username}
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="Password"
          type={passwordType("matrixPassword")}
          autocomplete="off"
          bind:value={form.password}
          enter={() => void saveChannel()}
          trailing={passwordTrailing("matrixPassword")}
        />
        <TextFieldOutlined
          label="Allowed senders (comma separated)"
          bind:value={form.allowedSenders}
          enter={() => void saveChannel()}
        />
        <p class="muted hint">
          Authenticate with an access token or username + password. Set a room ID to post into a
          room, or a DM user to let the bot open (or reuse) the direct message room with that
          person. Allowed senders is an optional comma-separated allowlist.
        </p>
      {:else if dialogType === "discord"}
        <TextFieldOutlined
          label="Webhook URL"
          bind:value={form.webhookUrl}
          placeholder="https://discord.com/api/webhooks/…"
          enter={() => void saveChannel()}
        />
      {:else}
        <TextFieldOutlined
          label="Host"
          bind:value={form.host}
          placeholder="smtp.example.org"
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="Port"
          type="number"
          bind:value={form.port}
          enter={() => void saveChannel()}
        />
        <label class="secure-toggle">
          <Switch bind:checked={form.secure} />
          <span>Secure connection (TLS)</span>
        </label>
        <TextFieldOutlined
          label="Username"
          autocomplete="off"
          bind:value={form.username}
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="Password"
          type={passwordType("emailPassword")}
          autocomplete="off"
          bind:value={form.password}
          enter={() => void saveChannel()}
          trailing={passwordTrailing("emailPassword")}
        />
        <TextFieldOutlined
          label="From"
          bind:value={form.from}
          placeholder="briefs@example.org"
          enter={() => void saveChannel()}
        />
        <TextFieldOutlined
          label="To (comma separated)"
          bind:value={form.to}
          enter={() => void saveChannel()}
        />
      {/if}
    </div>
    {#snippet buttons()}
      <Button variant="text" onclick={() => (channelDialogOpen = false)} disabled={savingChannel}>
        Cancel
      </Button>
      <Button variant="filled" onclick={() => void saveChannel()} disabled={!canSaveChannel}>
        Save
      </Button>
    {/snippet}
  </Dialog>

  <Dialog headline="Delete this channel?" bind:open={confirmingDelete}>
    <p>
      Channel "{deleteTarget?.name}"
      ({deleteTarget ? TYPE_LABELS[deleteTarget.type] : ""}) will be removed and detached from all
      workflows. This cannot be undone.
    </p>
    {#snippet buttons()}
      <Button variant="text" onclick={() => (confirmingDelete = false)} disabled={deleting}>
        Cancel
      </Button>
      <span class="danger">
        <Button variant="filled" onclick={() => void removeChannel()} disabled={deleting}>
          Delete
        </Button>
      </span>
    {/snippet}
  </Dialog>
</Pane>

<style>
  .intro {
    @apply --m3-body-medium;
    margin: 0 0 1.25rem;
    max-width: 44rem;
  }

  .group {
    max-width: 60rem;
    margin-bottom: 1.5rem;
  }

  .group h3 {
    @apply --m3-title-small;
    margin: 0 0 0.5rem;
    color: var(--m3c-on-surface-variant);
  }

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
  }

  .info {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
    flex: 1 1 auto;
  }

  .name {
    @apply --m3-body-large;
    display: flex;
    align-items: center;
    gap: 0.4rem;
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
    gap: 0.5rem;
    flex: 0 0 auto;
  }

  .attach {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .secure-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--m3c-on-surface-variant);
    font-size: 0.85rem;
    cursor: pointer;
    user-select: none;
  }

  .type-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .hint {
    margin: 0;
  }

  .channel-form {
    display: flex;
    flex-direction: column;
    gap: 0.9rem;
    width: min(24rem, 100%);
  }
</style>
