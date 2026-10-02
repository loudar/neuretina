<script lang="ts">
  import { Select } from "m3-svelte";
  import type { SettingInfo } from "../lib/api";
  import { commands } from "../lib/commands";
  import { configState } from "../lib/config.svelte";
  import type { ConnectionGroupConfig } from "../lib/settingsConnections";
  import ConnectionSection from "./ConnectionSection.svelte";
  import SettingRow from "./SettingRow.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  interface Props {
    config: ConnectionGroupConfig;
    id: string;
    /** Parsed connections of this group's provider kind. */
    connections: Array<{ id: string } & Record<string, unknown>>;
    /** Stored active selection (raw), for fallback checks. */
    activeValue?: string | null;
    /** Persists a changed connection-list setting into the view state. */
    onapply: (setting: SettingInfo) => void;
    onactivechange?: (event: Event) => void;
  }

  let { config, id, connections, activeValue = null, onapply, onactivechange }: Props = $props();

  const selected = $derived(
    connections.find((connection) => connection.id === activeValue) ?? connections[0] ?? null,
  );
  const options = $derived(
    connections.map((connection) => ({
      text: config.label(connection as never),
      value: connection.id,
    })),
  );

  // A changed connection list must keep the active selection valid: the first
  // connection becomes active when the current one disappears.
  async function onchanged(setting: SettingInfo): Promise<void> {
    onapply(setting);
    await configState.load();
    if (!config.activeKey) return;
    const available = config.parseIds(setting.value);
    if (available.includes(activeValue ?? "")) return;
    const next = available[0];
    onapply(
      next
        ? await commands.settings.set(config.activeKey, next)
        : await commands.settings.clear(config.activeKey),
    );
    await configState.load();
  }
</script>

<SettingsSection group={config.group} {id}>
  {#if config.activeTitle}
    <SettingRow label={config.activeTitle} source={config.activeSummary?.(selected as never)}>
      {#snippet children()}
        {#if options.length > 0 && onactivechange}
          <Select
            label={config.activeTitle}
            width="16rem"
            {options}
            value={selected?.id ?? ""}
            onchange={onactivechange}
          />
        {:else}
          <p class="muted">{config.activeEmpty}</p>
        {/if}
      {/snippet}
    </SettingRow>
  {/if}

  <ConnectionSection
    settingKey={config.settingKey}
    connections={connections}
    presets={config.presets}
    providerIds={config.providerIds}
    noun={config.noun}
    header={config.header}
    empty={config.empty}
    icon={config.icon}
    label={config.label}
    subtitle={config.subtitle}
    formOf={config.formOf}
    build={config.build}
    verify={config.verify}
    uniqueProvider={config.uniqueProvider}
    allowDuplicate={config.allowDuplicate}
    removeNote={config.removeNote}
    changed={onchanged}
  />
</SettingsSection>
