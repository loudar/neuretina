<script lang="ts">
  import { Button, Icon, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconSave from "@ktibow/iconset-material-symbols/save";
  import iconUndo from "@ktibow/iconset-material-symbols/undo";
  import type { SettingInfo } from "../lib/api";
  import SecretField from "./SecretField.svelte";
  import SettingRow from "./SettingRow.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  interface Props {
    group: string;
    id: string;
    settings: SettingInfo[];
    /** Unsaved values keyed by setting key (owned by the view). */
    drafts: Record<string, string>;
    /** Setting currently being written, if any. */
    busy: string | null;
    onsave: (setting: SettingInfo) => void;
    /** Asks the view to confirm and reset the stored value. */
    onclear: (setting: SettingInfo) => void;
    ontoggle: (setting: SettingInfo, checked: boolean) => void;
    onchoose: (setting: SettingInfo, event: Event) => void;
  }

  let { group, id, settings, drafts, busy, onsave, onclear, ontoggle, onchoose }: Props = $props();

  function draftOf(setting: SettingInfo): string {
    return drafts[setting.key] ?? "";
  }

  function canSave(setting: SettingInfo): boolean {
    return setting.source !== "env" && draftOf(setting) !== (setting.value ?? "") && busy === null;
  }

  function placeholder(setting: SettingInfo): string {
    if (setting.kind === "secret") return setting.configured ? "•••••• (set)" : "Not set";
    return setting.defaultValue ?? "";
  }
</script>

<SettingsSection {group} {id}>
  {#each settings as setting (setting.key)}
    <SettingRow
      label={setting.label}
      overridden={setting.source === "env"}
      overrideTitle={`Overridden by the ${setting.key} environment variable: the value from .env wins and edits here are ignored.`}
    >
      {#snippet children()}
        {#if setting.kind === "boolean"}
          <Switch
            checked={setting.value === "true"}
            disabled={setting.source === "env" || busy === setting.key}
            onchange={() => ontoggle(setting, setting.value !== "true")}
          />
        {:else if setting.kind === "enum"}
          <Select
            label="Value"
            width="12rem"
            options={(setting.options ?? []).map((option) => ({ text: option, value: option }))}
            value={draftOf(setting)}
            disabled={setting.source === "env" || busy === setting.key}
            onchange={(event) => onchoose(setting, event)}
          />
        {:else if setting.kind === "secret"}
          <SecretField
            label="Value"
            placeholder={placeholder(setting)}
            disabled={setting.source === "env"}
            bind:value={drafts[setting.key]}
            enter={() => onsave(setting)}
          />
        {:else}
          <TextFieldOutlined
            label="Value"
            type={setting.kind === "number" ? "number" : "text"}
            placeholder={placeholder(setting)}
            disabled={setting.source === "env"}
            autocomplete="off"
            spellcheck={false}
            bind:value={drafts[setting.key]}
            enter={() => onsave(setting)}
          />
        {/if}

        <div class="buttons">
          {#if setting.kind !== "boolean"}
            <Button
              variant="filled"
              iconType="left"
              onclick={() => onsave(setting)}
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
              onclick={() => onclear(setting)}
              disabled={busy === setting.key}
            >
              <Icon icon={iconUndo} /> Reset
            </Button>
          {/if}
        </div>
      {/snippet}
    </SettingRow>
  {/each}
</SettingsSection>

<style>
  .buttons {
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }
</style>
