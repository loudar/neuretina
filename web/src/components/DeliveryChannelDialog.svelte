<script lang="ts">
  import { Button, Dialog, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import type { DeliveryChannelInfo, DeliveryChannelType } from "../lib/api";
  import { commands } from "../lib/commands";
  import { DELIVERY_TYPE_LABELS, deliveryTypeOptions } from "../lib/delivery";
  import { reportError, reportSuccess } from "../lib/feedback";
  import SecretField from "./SecretField.svelte";

  interface Props {
    open: boolean;
    /** Existing channel when editing; null adds a new one. */
    channel?: DeliveryChannelInfo | null;
    /** Prefill from this channel under a "(copy)" name instead of editing. */
    duplicate?: DeliveryChannelInfo | null;
    onsaved: (channel: DeliveryChannelInfo, created: boolean) => void;
  }

  let { open = $bindable(), channel = null, duplicate = null, onsaved }: Props = $props();

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

  let type = $state<DeliveryChannelType>("matrix");
  let editingId = $state<string | null>(null);
  let form = $state<ChannelForm>({ ...emptyForm });
  /** Snapshot of the edited channel; a save needs a change from it. */
  let baseForm = $state<ChannelForm | null>(null);
  let saving = $state(false);

  function formFromConfig(source: DeliveryChannelInfo): ChannelForm {
    const text = (key: string): string => {
      const value = source.config[key];
      return typeof value === "string" || typeof value === "number" ? String(value) : "";
    };
    return {
      name: source.name,
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
      secure: source.config.secure !== false,
      from: text("from"),
      to: text("to"),
    };
  }

  // Reset the form each time the dialog opens.
  $effect(() => {
    if (!open) return;
    if (channel) {
      editingId = channel.id;
      type = channel.type;
      form = formFromConfig(channel);
      baseForm = { ...form };
    } else if (duplicate) {
      editingId = null;
      baseForm = null;
      type = duplicate.type;
      form = { ...formFromConfig(duplicate), name: `${duplicate.name} (copy)` };
    } else {
      editingId = null;
      baseForm = null;
      type = "matrix";
      form = { ...emptyForm };
    }
  });

  const unchanged = $derived(baseForm !== null && JSON.stringify(form) === JSON.stringify(baseForm));
  const canSave = $derived.by(() => {
    if (saving || unchanged || !form.name.trim()) return false;
    if (type === "matrix") {
      return form.homeserverUrl.trim() !== "" && (form.roomId.trim() !== "" || form.dmUserId.trim() !== "");
    }
    if (type === "discord") return form.webhookUrl.trim() !== "";
    return form.host.trim() !== "";
  });

  // Config values are stored as strings; the SMTP port is a number.
  function configFromForm(): Record<string, unknown> {
    if (type === "matrix") {
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
    if (type === "discord") return { webhookUrl: form.webhookUrl.trim() };
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

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      const config = configFromForm();
      if (editingId) {
        const updated = await commands.delivery.updateChannel(editingId, {
          name: form.name.trim(),
          config,
        });
        onsaved(updated, false);
        reportSuccess(`Channel "${updated.name}" saved`);
      } else {
        const created = await commands.delivery.createChannel({
          type,
          name: form.name.trim(),
          config,
        });
        onsaved(created, true);
        reportSuccess(`Channel "${created.name}" added`);
      }
      open = false;
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }
</script>

<Dialog headline={editingId ? "Edit channel" : "Add channel"} bind:open>
  <div class="channel-form">
    {#if editingId}
      <div class="type-row">
        <span class="muted">Type</span>
        <span class="provider-tag" data-provider={type}>{DELIVERY_TYPE_LABELS[type]}</span>
      </div>
    {:else}
      <Select
        label="Type"
        options={deliveryTypeOptions}
        value={type}
        onchange={(event) => {
          const value = event.currentTarget.value;
          if (value === "matrix" || value === "discord" || value === "email") type = value;
        }}
      />
    {/if}
    <TextFieldOutlined label="Name" bind:value={form.name} enter={() => void save()} />
    {#if type === "matrix"}
      <TextFieldOutlined
        label="Homeserver URL"
        bind:value={form.homeserverUrl}
        placeholder="https://matrix.example.org"
        enter={() => void save()}
      />
      <TextFieldOutlined
        label="Room ID"
        bind:value={form.roomId}
        placeholder="!room:matrix.example.org"
        enter={() => void save()}
      />
      <TextFieldOutlined
        label="DM user (Matrix ID)"
        bind:value={form.dmUserId}
        placeholder="@alice:matrix.example.org"
        enter={() => void save()}
      />
      <SecretField label="Access token" bind:value={form.accessToken} enter={() => void save()} />
      <TextFieldOutlined
        label="Username"
        autocomplete="off"
        bind:value={form.username}
        enter={() => void save()}
      />
      <SecretField label="Password" bind:value={form.password} enter={() => void save()} />
      <TextFieldOutlined
        label="Allowed senders (comma separated)"
        bind:value={form.allowedSenders}
        enter={() => void save()}
      />
    {:else if type === "discord"}
      <TextFieldOutlined
        label="Webhook URL"
        bind:value={form.webhookUrl}
        placeholder="https://discord.com/api/webhooks/…"
        enter={() => void save()}
      />
    {:else}
      <TextFieldOutlined
        label="Host"
        bind:value={form.host}
        placeholder="smtp.example.org"
        enter={() => void save()}
      />
      <TextFieldOutlined label="Port" type="number" bind:value={form.port} enter={() => void save()} />
      <label class="secure-toggle">
        <Switch bind:checked={form.secure} />
        <span>Secure connection (TLS)</span>
      </label>
      <TextFieldOutlined
        label="Username"
        autocomplete="off"
        bind:value={form.username}
        enter={() => void save()}
      />
      <SecretField label="Password" bind:value={form.password} enter={() => void save()} />
      <TextFieldOutlined
        label="From"
        bind:value={form.from}
        placeholder="reports@example.org"
        enter={() => void save()}
      />
      <TextFieldOutlined
        label="To (comma separated)"
        bind:value={form.to}
        enter={() => void save()}
      />
    {/if}
  </div>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={saving}>Cancel</Button>
    <Button variant="filled" onclick={() => void save()} disabled={!canSave}>Save</Button>
  {/snippet}
</Dialog>

<style>
  .channel-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
  }

  .type-row {
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }

  .secure-toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-small);
    color: var(--m3c-on-surface-variant);
    font-size: var(--font-medium);
    cursor: pointer;
    user-select: none;
  }

  .hint {
    margin: 0;
  }
</style>
