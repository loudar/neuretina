<script lang="ts" generics="C extends { id: string }, P extends string">
  import { Button, Dialog, Icon, Select, TextFieldOutlined } from "m3-svelte";
  import iconAdd from "@ktibow/iconset-material-symbols/add";
  import iconCopy from "@ktibow/iconset-material-symbols/content-copy";
  import iconEdit from "@ktibow/iconset-material-symbols/edit";
  import { commands } from "../lib/commands";
  import type { ConnectionPreset, SettingInfo } from "../lib/api";
  import { reportError, reportSuccess } from "../lib/feedback";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import DataList from "./DataList.svelte";
  import DeleteIconButton from "./DeleteIconButton.svelte";
  import SecretField from "./SecretField.svelte";

  interface Props {
    /** Setting the JSON connection list is stored under. */
    settingKey: string;
    connections: C[];
    presets: Record<P, ConnectionPreset>;
    providerIds: P[];
    /** Dialog noun, e.g. "decision model". */
    noun: string;
    /** Label of the add row above the list, e.g. "Hosted connections". */
    header: string;
    empty: string;
    icon: string;
    label: (connection: C) => string;
    subtitle: (connection: C) => string;
    formOf: (connection: C) => Record<string, string>;
    build: (form: Record<string, string>, id: string) => C;
    verify: (payload: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
    changed: (setting: SettingInfo) => Promise<void> | void;
    /** One connection per provider keeps the tool/view names unambiguous. */
    uniqueProvider?: boolean;
    allowDuplicate?: boolean;
    removeNote?: string;
  }

  let {
    settingKey,
    connections,
    presets,
    providerIds,
    noun,
    header,
    empty,
    icon,
    label,
    subtitle,
    formOf,
    build,
    verify,
    changed,
    uniqueProvider = false,
    allowDuplicate = true,
    removeNote,
  }: Props = $props();

  let dialogOpen = $state(false);
  let editingId = $state<string | null>(null);
  let form = $state<Record<string, string>>(blankForm(""));
  let saving = $state(false);
  let testing = $state<string | null>(null);
  let deleteTarget = $state<C | null>(null);
  let confirmingDelete = $state(false);

  const availableProviders = $derived(
    uniqueProvider
      ? providerIds.filter((provider) => !connections.some((entry) => entry.provider === provider))
      : providerIds,
  );
  const providerOptions = $derived(
    availableProviders.map((provider) => ({ text: presets[provider].label, value: provider })),
  );
  const preset = $derived(presets[form.provider as P]);
  const hasModel = $derived((preset?.models?.length ?? 0) > 0);
  const canSave = $derived.by(() => {
    if (saving) return false;
    if (!form.baseUrl?.trim()) return false;
    if (hasModel && !form.model?.trim()) return false;
    if (preset?.accountScoped && !form.accountId?.trim()) return false;
    return true;
  });

  function blankForm(provider: string): Record<string, string> {
    const entry = presets[provider as P];
    return {
      provider,
      model: entry?.defaultModel ?? "",
      baseUrl: entry?.defaultBaseUrl ?? "",
      accountId: "",
      apiKey: "",
    };
  }

  function openAdd(): void {
    editingId = null;
    form = blankForm(availableProviders[0] ?? providerIds[0] ?? "");
    dialogOpen = true;
  }

  function openEdit(connection: C): void {
    editingId = connection.id;
    form = formOf(connection);
    dialogOpen = true;
  }

  function openDuplicate(connection: C): void {
    editingId = null;
    form = formOf(connection);
    dialogOpen = true;
  }

  function chooseProvider(event: Event): void {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target || !providerIds.includes(target.value as P)) return;
    // Keep the key when switching provider so a typo does not discard it.
    form = { ...blankForm(target.value), apiKey: form.apiKey };
  }

  /** Unsaved form values, trimmed, for the live test request. */
  function formPayload(): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(form)) {
      if (value.trim()) payload[key] = value.trim();
    }
    return payload;
  }

  async function save(): Promise<void> {
    if (!canSave) return;
    saving = true;
    try {
      const connection = build(form, editingId ?? crypto.randomUUID());
      const next = editingId
        ? connections.map((entry) => (entry.id === connection.id ? connection : entry))
        : [...connections, connection];
      await changed(await commands.settings.set(settingKey, JSON.stringify(next)));
      dialogOpen = false;
      reportSuccess(`${label(connection)} saved`);
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    const target = deleteTarget;
    if (!target || saving) return;
    saving = true;
    try {
      const next = connections.filter((entry) => entry.id !== target.id);
      await changed(await commands.settings.set(settingKey, JSON.stringify(next)));
      confirmingDelete = false;
      reportSuccess(`${label(target)} deleted`);
    } catch (error) {
      reportError(error);
    } finally {
      saving = false;
    }
  }

  async function test(target: C | null): Promise<void> {
    testing = target ? target.id : "form";
    try {
      const result = await verify(target ? { id: target.id } : formPayload());
      const name = target ? label(target) : (preset?.label ?? "connection");
      if (result.ok) reportSuccess(`${name} ${result.detail}`);
      else reportError(`${name}: ${result.detail}`);
    } catch (error) {
      reportError(error);
    } finally {
      testing = null;
    }
  }
</script>

<article class="setting">
  <div class="info">
    <div class="name"><span>{header}</span></div>
  </div>
  <div class="control">
    <Button
      variant="tonal"
      iconType="left"
      onclick={openAdd}
      disabled={uniqueProvider && availableProviders.length === 0}
    >
      <Icon icon={iconAdd} /> Add connection
    </Button>
  </div>
</article>

<DataList items={connections} {empty}>
  {#snippet children(connection)}
    <article class="row">
      <div class="info">
        <div class="name">
          <Icon icon={icon} size={18} />
          <span>{label(connection)}</span>
          <span class="provider-tag" data-provider={connection.provider}>
            {presets[connection.provider as P]?.label ?? connection.provider}
          </span>
        </div>
        <p class="desc muted">{subtitle(connection)}</p>
      </div>
      <div class="control">
        <Button
          variant="text"
          title="Send a live test request through this connection"
          onclick={() => void test(connection)}
          disabled={testing === connection.id}
        >
          {testing === connection.id ? "Testing…" : "Test"}
        </Button>
        {#if allowDuplicate}
          <Button
            variant="text"
            iconType="full"
            title={`Duplicate ${noun} into the add form`}
            onclick={() => openDuplicate(connection)}
          >
            <Icon icon={iconCopy} />
          </Button>
        {/if}
        <Button
          variant="text"
          iconType="full"
          title={`Edit ${noun}`}
          onclick={() => openEdit(connection)}
        >
          <Icon icon={iconEdit} />
        </Button>
        <DeleteIconButton
          title={`Delete ${noun}`}
          onclick={() => {
            deleteTarget = connection;
            confirmingDelete = true;
          }}
        />
      </div>
    </article>
  {/snippet}
</DataList>

<Dialog headline={editingId ? `Edit ${noun}` : `Add ${noun}`} bind:open={dialogOpen}>
  <div class="connection-form">
    {#if editingId}
      <div class="type-row">
        <span class="muted">Provider</span>
        <span class="provider-tag" data-provider={form.provider}>{preset?.label ?? form.provider}</span>
      </div>
    {:else}
      <Select
        label="Provider"
        options={providerOptions}
        value={form.provider}
        onchange={chooseProvider}
      />
    {/if}
    {#if hasModel}
      <TextFieldOutlined
        label="Model"
        bind:value={form.model}
        placeholder={preset?.defaultModel ?? ""}
        enter={() => void save()}
      />
    {/if}
    <TextFieldOutlined
      label={preset?.endpointLabel ?? "API base URL"}
      bind:value={form.baseUrl}
      placeholder={preset?.defaultBaseUrl ?? ""}
      enter={() => void save()}
    />
    {#if preset?.accountScoped}
      <TextFieldOutlined
        label="Account ID"
        bind:value={form.accountId}
        enter={() => void save()}
      />
    {/if}
    {#if preset?.apiKey !== false}
      <SecretField label="API key" bind:value={form.apiKey} enter={() => void save()} />
    {/if}
  </div>
  {#snippet buttons()}
    <Button
      variant="text"
      onclick={() => void test(null)}
      disabled={testing === "form" || !canSave}
    >
      {testing === "form" ? "Testing…" : "Test"}
    </Button>
    <Button variant="text" onclick={() => (dialogOpen = false)} disabled={saving}>Cancel</Button>
    <Button variant="filled" onclick={() => void save()} disabled={!canSave}>Save</Button>
  {/snippet}
</Dialog>

<ConfirmDeleteDialog
  bind:open={confirmingDelete}
  headline={`Delete this ${noun}?`}
  message={`Connection "${deleteTarget ? label(deleteTarget) : ""}" will be removed.${
    removeNote ? ` ${removeNote}` : ""
  }`}
  busy={saving}
  onconfirm={() => void remove()}
  oncancel={() => (confirmingDelete = false)}
/>

<style>
  .setting {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-large);
    padding: var(--space-medium) 0;
  }

  .info {
    display: flex;
    flex-direction: column;
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

  .row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-large);
    padding: var(--space-medium) 0;
  }

  .connection-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
    width: min(24rem, 100%);
  }

  .type-row {
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }
</style>
