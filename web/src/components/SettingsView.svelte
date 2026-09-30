<script lang="ts">
  import { onMount } from "svelte";
  import { Button, Icon, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconSave from "@ktibow/iconset-material-symbols/save";
  import iconUndo from "@ktibow/iconset-material-symbols/undo";
  import iconWarning from "@ktibow/iconset-material-symbols/warning";
  import { commands, type SettingInfo } from "../lib/api";
  import { configState } from "../lib/config.svelte";
  import { reportError, reportSuccess } from "../lib/feedback";
  import Pane from "./Pane.svelte";

  let settings = $state<SettingInfo[]>([]);
  let drafts = $state<Record<string, string>>({});
  let loading = $state(true);
  let busy = $state<string | null>(null);

  const groups = $derived([...new Set(settings.map((setting) => setting.group))]);

  onMount(() => void refresh());

  async function refresh(): Promise<void> {
    try {
      const loaded = await commands.settings.list();
      settings = loaded;
      drafts = Object.fromEntries(loaded.map((setting) => [setting.key, setting.value ?? ""]));
    } catch (error) {
      reportError(error);
    } finally {
      loading = false;
    }
  }

  function inGroup(group: string): SettingInfo[] {
    return settings.filter((setting) => setting.group === group);
  }

  function draftOf(setting: SettingInfo): string {
    return drafts[setting.key] ?? "";
  }

  function isDirty(setting: SettingInfo): boolean {
    if (setting.kind === "secret") return draftOf(setting).trim().length > 0;
    return draftOf(setting) !== (setting.value ?? "");
  }

  function canSave(setting: SettingInfo): boolean {
    return setting.source !== "env" && isDirty(setting) && busy === null;
  }

  function apply(setting: SettingInfo): void {
    settings = settings.map((entry) => (entry.key === setting.key ? setting : entry));
    drafts[setting.key] = setting.value ?? "";
  }

  async function save(setting: SettingInfo): Promise<void> {
    busy = setting.key;
    try {
      apply(await commands.settings.set(setting.key, draftOf(setting)));
      await configState.load();
      reportSuccess(`${setting.label} saved`);
    } catch (error) {
      reportError(error);
    } finally {
      busy = null;
    }
  }

  async function clear(setting: SettingInfo): Promise<void> {
    busy = setting.key;
    try {
      apply(await commands.settings.clear(setting.key));
      await configState.load();
      reportSuccess(`${setting.label} reset`);
    } catch (error) {
      reportError(error);
    } finally {
      busy = null;
    }
  }

  async function toggle(setting: SettingInfo, checked: boolean): Promise<void> {
    busy = setting.key;
    try {
      apply(await commands.settings.set(setting.key, checked ? "true" : "false"));
      await configState.load();
    } catch (error) {
      reportError(error);
      await refresh();
    } finally {
      busy = null;
    }
  }

  async function choose(setting: SettingInfo, event: Event): Promise<void> {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    drafts[setting.key] = target.value;
    await save(setting);
  }

  function sourceLabel(setting: SettingInfo): string {
    if (setting.source === "env") return "from environment";
    if (setting.source === "db") return "from database";
    return "default";
  }

  function placeholder(setting: SettingInfo): string {
    if (setting.kind === "secret") return setting.configured ? "•••••• (set)" : "Not set";
    return setting.defaultValue ?? "";
  }
</script>

<Pane variant="detail" title="Settings">
  {#snippet actions()}
    <Button variant="text" onclick={() => void refresh()} disabled={loading}>Reload</Button>
  {/snippet}

  <p class="muted intro">
    Stored in the SQLite database and applied immediately. Values provided by
    <code>.env</code> always win over the database and are marked with a warning. Boot-time
    settings (<code>PORT</code>, <code>DB_PATH</code>, <code>TZ</code>, <code>LOG_LEVEL</code>) stay
    in <code>.env</code>.
  </p>

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else}
    {#each groups as group (group)}
      <section class="group">
        <h3>{group}</h3>

        {#each inGroup(group) as setting (setting.key)}
          <article class="setting">
            <div class="info">
              <div class="name">
                <span>{setting.label}</span>
                {#if setting.source === "env"}
                  <span
                    class="override"
                    title={`Overridden by the ${setting.key} environment variable: the value from .env wins and edits here are ignored.`}
                  >
                    <Icon icon={iconWarning} size={16} />
                  </span>
                {/if}
              </div>
              {#if setting.description}
                <p class="desc muted">{setting.description}</p>
              {/if}
              <span class="source" class:env={setting.source === "env"}>
                {sourceLabel(setting)}
              </span>
            </div>

            <div class="control">
              {#if setting.kind === "boolean"}
                <Switch
                  checked={setting.value === "true"}
                  disabled={setting.source === "env" || busy === setting.key}
                  onchange={() => void toggle(setting, setting.value !== "true")}
                />
              {:else if setting.kind === "enum"}
                <Select
                  label="Value"
                  width="12rem"
                  options={(setting.options ?? []).map((option) => ({ text: option, value: option }))}
                  value={draftOf(setting)}
                  disabled={setting.source === "env" || busy === setting.key}
                  onchange={(event) => void choose(setting, event)}
                />
              {:else}
                <TextFieldOutlined
                  label="Value"
                  type={setting.kind === "secret"
                    ? "password"
                    : setting.kind === "number"
                      ? "number"
                      : "text"}
                  placeholder={placeholder(setting)}
                  disabled={setting.source === "env"}
                  autocomplete="off"
                  spellcheck={false}
                  bind:value={drafts[setting.key]}
                  enter={() => void save(setting)}
                />
              {/if}

              <div class="buttons">
                {#if setting.kind !== "boolean"}
                  <Button
                    variant="filled"
                    iconType="left"
                    onclick={() => void save(setting)}
                    disabled={!canSave(setting)}
                  >
                    <Icon icon={iconSave} /> Save
                  </Button>
                {/if}
                {#if setting.stored}
                  <Button
                    variant="outlined"
                    iconType="left"
                    title="Delete the stored database value"
                    onclick={() => void clear(setting)}
                    disabled={busy === setting.key}
                  >
                    <Icon icon={iconUndo} /> Reset
                  </Button>
                {/if}
              </div>
            </div>
          </article>
        {/each}
      </section>
    {/each}
  {/if}
</Pane>

<style>
  .intro {
    @apply --m3-body-medium;
    margin: 0 0 1.25rem;
    max-width: 44rem;
  }

  .intro code {
    @apply --m3-body-small;
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

  .setting {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0;
  }

  .setting + .setting {
    border-top: 1px solid var(--m3c-outline-variant);
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
    gap: 0.3rem;
  }

  .override {
    display: inline-flex;
    color: light-dark(#9a6700, #e8c26a);
    cursor: help;
  }

  .desc {
    @apply --m3-body-small;
    margin: 0;
  }

  .source {
    @apply --m3-label-medium;
    color: var(--m3c-on-surface-variant);
  }

  .source.env {
    color: light-dark(#9a6700, #e8c26a);
  }

  .control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 0.5rem;
    flex: 0 0 auto;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }
</style>
