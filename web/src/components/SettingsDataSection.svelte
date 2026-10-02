<script lang="ts">
  import { Button, Icon } from "m3-svelte";
  import iconDownload from "@ktibow/iconset-material-symbols/download";
  import iconUpload from "@ktibow/iconset-material-symbols/upload";
  import type { DataBundle, DataImportSummary } from "../lib/api";
  import { commands } from "../lib/commands";
  import { configState } from "../lib/config.svelte";
  import { reportError, reportSuccess } from "../lib/feedback";
  import SettingRow from "./SettingRow.svelte";
  import SettingsSection from "./SettingsSection.svelte";

  interface Props {
    group: string;
    id: string;
    /** Re-reads the settings after an import overwrote local overrides. */
    onimported: () => Promise<void>;
  }

  let { group, id, onimported }: Props = $props();

  let exporting = $state(false);
  let importing = $state(false);
  let summary = $state<DataImportSummary | null>(null);
  let fileInput = $state<HTMLInputElement | null>(null);

  async function exportData(): Promise<void> {
    exporting = true;
    try {
      const bundle = await commands.data.export();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `neuretina-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      reportSuccess("Configuration exported");
    } catch (error) {
      reportError(error);
    } finally {
      exporting = false;
    }
  }

  async function importData(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    importing = true;
    summary = null;
    try {
      const bundle = JSON.parse(await file.text()) as DataBundle;
      const imported = await commands.data.import(bundle);
      summary = imported;
      await configState.load();
      // Imported settings overwrote the local overrides: refetch so the
      // fields (and their revealable values) show the new state.
      if (imported.settings > 0) await onimported();
      reportSuccess(
        `Imported ${imported.topics} topic(s), ${imported.userWorkflows} workflow(s), ` +
          `${imported.deliveryChannels} channel(s), ${imported.jobs} schedule(s), ` +
          `${imported.settings} setting(s)`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      importing = false;
    }
  }
</script>

<SettingsSection {group} {id}>
  <SettingRow
    label="Import / export configuration"
    description="The exported file carries credentials; treat it as a secret."
    source={summary
      ? `Last import: ${summary.topics} topic(s), ${summary.userWorkflows} workflow(s), ` +
        `${summary.deliveryChannels} channel(s), ${summary.jobs} schedule(s), ` +
        `${summary.settings} setting(s)`
      : undefined}
  >
    {#snippet children()}
      <div class="buttons">
        <Button
          variant="filled"
          iconType="left"
          onclick={() => void exportData()}
          disabled={exporting}
        >
          <Icon icon={iconDownload} /> {exporting ? "Exporting…" : "Export"}
        </Button>
        <Button
          variant="outlined"
          iconType="left"
          onclick={() => fileInput?.click()}
          disabled={importing}
        >
          <Icon icon={iconUpload} /> {importing ? "Importing…" : "Import"}
        </Button>
      </div>
      <input
        bind:this={fileInput}
        class="file"
        type="file"
        accept="application/json,.json"
        onchange={(event) => void importData(event)}
      />
    {/snippet}
  </SettingRow>
</SettingsSection>

<style>
  .buttons {
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }

  .file {
    display: none;
  }
</style>
