<script lang="ts">
  import { onMount } from "svelte";
  import { Button, Icon, Select, Switch, TextFieldOutlined } from "m3-svelte";
  import iconDownload from "@ktibow/iconset-material-symbols/download";
  import iconFinance from "@ktibow/iconset-material-symbols/finance";
  import iconPsychology from "@ktibow/iconset-material-symbols/psychology";
  import iconSave from "@ktibow/iconset-material-symbols/save";
  import iconSearch from "@ktibow/iconset-material-symbols/search";
  import iconSmartToy from "@ktibow/iconset-material-symbols/smart-toy";
  import iconUndo from "@ktibow/iconset-material-symbols/undo";
  import iconUpload from "@ktibow/iconset-material-symbols/upload";
  import iconWarning from "@ktibow/iconset-material-symbols/warning";
  import { commands } from "../lib/commands";
  import type {
    DataBundle,
    DataImportSummary,
    DecisionProviderId,
    FinanceProviderId,
    LlmProviderId,
    SearchConnection,
    SearchProviderId,
    SettingInfo,
  } from "../lib/api";
  import {
    DECISION_PROVIDER_IDS,
    DECISION_PROVIDER_PRESETS,
    decisionModelLabel,
    FINANCE_PROVIDER_IDS,
    FINANCE_PROVIDER_PRESETS,
    LLM_PROVIDER_IDS,
    LLM_PROVIDER_PRESETS,
    llmProviderLabel,
    parseDecisionModelConnections,
    parseFinanceConnections,
    parseLlmConnections,
    parseSearchConnections,
    SEARCH_PROVIDER_IDS,
    SEARCH_PROVIDER_PRESETS,
  } from "../lib/api";
  import { configState } from "../lib/config.svelte";
  import { reportError, reportSuccess } from "../lib/feedback";
  import Pane from "./Pane.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import ConnectionSection from "./ConnectionSection.svelte";
  import SecretField from "./SecretField.svelte";

  let settings = $state<SettingInfo[]>([]);
  let drafts = $state<Record<string, string>>({});
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let resetTarget = $state<SettingInfo | null>(null);
  let confirmingReset = $state(false);

  const groups = $derived([...new Set(settings.map((setting) => setting.group))]);

  /** Custom panels that are not rendered by the generic settings form. */
  const DATA_GROUP = "Data transfer";
  const LLM_GROUP = "LLM";
  const DECISION_GROUP = "Decision models";
  const SEARCH_GROUP = "Web search";
  const FINANCE_GROUP = "Finance data";
  const LLM_PROVIDERS_KEY = "LLM_PROVIDERS";
  const LLM_PROVIDER_KEY = "LLM_PROVIDER";
  const DECISION_MODELS_KEY = "DECISION_MODELS";
  const DECISION_MODEL_KEY = "DECISION_MODEL";
  const SEARCH_PROVIDERS_KEY = "SEARCH_PROVIDERS";
  const SEARCH_PROVIDER_KEY = "SEARCH_PROVIDER";
  const FINANCE_PROVIDERS_KEY = "FINANCE_PROVIDERS";

  const customGroups = [LLM_GROUP, DECISION_GROUP, SEARCH_GROUP, FINANCE_GROUP];
  const genericGroups = $derived(groups.filter((group) => !customGroups.includes(group)));
  const navGroups = $derived([DATA_GROUP, ...customGroups, ...genericGroups]);

  function settingValue(key: string): string | null {
    return settings.find((entry) => entry.key === key)?.value ?? null;
  }

  // ── Connections ──────────────────────────────────────────────────────────
  // Decision models, web search and finance data are dynamic connection
  // lists; the shared section stores them as JSON settings so they travel
  // with configuration exports.

  const llmConnections = $derived(parseLlmConnections(settingValue(LLM_PROVIDERS_KEY)));
  const decisionConnections = $derived(
    parseDecisionModelConnections(settingValue(DECISION_MODELS_KEY)),
  );
  const searchConnections = $derived(parseSearchConnections(settingValue(SEARCH_PROVIDERS_KEY)));
  const financeConnections = $derived(parseFinanceConnections(settingValue(FINANCE_PROVIDERS_KEY)));

  // LLM and search always run on a connection: an unset selection means the
  // first configured one, so the UI shows that as the active choice.
  const activeLlmConnection = $derived(
    llmConnections.find((connection) => connection.id === settingValue(LLM_PROVIDER_KEY)) ??
      llmConnections[0] ??
      null,
  );
  const activeLlmOptions = $derived(
    llmConnections.map((connection) => ({
      text: llmProviderLabel(connection),
      value: connection.id,
    })),
  );
  const activeSearchConnection = $derived(
    searchConnections.find((connection) => connection.id === settingValue(SEARCH_PROVIDER_KEY)) ??
      searchConnections[0] ??
      null,
  );
  const activeSearchOptions = $derived(
    searchConnections.map((connection) => ({
      text: searchConnectionLabel(connection),
      value: connection.id,
    })),
  );

  const activeDecisionId = $derived(settingValue(DECISION_MODEL_KEY) ?? "");
  const activeDecisionLabel = $derived.by(() => {
    const connection = decisionConnections.find((entry) => entry.id === activeDecisionId);
    return connection ? decisionModelLabel(connection) : null;
  });
  const activeDecisionOptions = $derived(
    decisionConnections.map((connection) => ({
      text: decisionModelLabel(connection),
      value: connection.id,
    })),
  );

  function searchConnectionLabel(connection: SearchConnection): string {
    return SEARCH_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider;
  }

  async function onConnectionChange(setting: SettingInfo): Promise<void> {
    apply(setting);
    await configState.load();
  }

  /**
   * Applies a changed connection list and keeps the active selection valid:
   * the first connection becomes active when the current one disappears.
   */
  async function onConnectionsChange(
    setting: SettingInfo,
    ids: (value: string | null) => string[],
    activeKey: string,
  ): Promise<void> {
    apply(setting);
    await configState.load();
    const available = ids(setting.value);
    if (available.includes(settingValue(activeKey) ?? "")) return;
    const next = available[0];
    apply(
      next ? await commands.settings.set(activeKey, next) : await commands.settings.clear(activeKey),
    );
    await configState.load();
  }

  async function chooseActive(key: string, event: Event): Promise<void> {
    const target = event.currentTarget as HTMLSelectElement | null;
    if (!target) return;
    try {
      apply(
        target.value
          ? await commands.settings.set(key, target.value)
          : await commands.settings.clear(key),
      );
      await configState.load();
    } catch (error) {
      reportError(error);
    }
  }

  let exporting = $state(false);
  let importing = $state(false);
  let importSummary = $state<DataImportSummary | null>(null);
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
    importSummary = null;
    try {
      const bundle = JSON.parse(await file.text()) as DataBundle;
      const summary = await commands.data.import(bundle);
      importSummary = summary;
      await configState.load();
      // Imported settings overwrote the local overrides: refetch so the
      // fields (and their revealable values) show the new state.
      if (summary.settings > 0) await refresh();
      reportSuccess(
        `Imported ${summary.topics} topic(s), ${summary.userWorkflows} workflow(s), ` +
          `${summary.deliveryChannels} channel(s), ${summary.jobs} schedule(s), ` +
          `${summary.settings} setting(s)`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      importing = false;
    }
  }

  let layout = $state<HTMLElement | null>(null);
  let activeGroup = $state<string | null>(null);
  /** Set while a click-initiated smooth scroll runs; scroll tracking waits. */
  let scrollTarget = $state<{ group: string; top: number } | null>(null);
  let settleTimer: ReturnType<typeof setTimeout> | null = null;

  function sectionId(group: string): string {
    return `settings-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  }

  function scroller(): HTMLElement | null {
    return layout?.closest<HTMLElement>(".body") ?? null;
  }

  function sectionTop(container: HTMLElement, section: HTMLElement): number {
    return (
      section.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop
    );
  }

  function updateActive(): void {
    const container = scroller();
    if (!container) return;

    // A click just started a smooth scroll: keep the clicked section
    // highlighted instead of letting the animation walk the selection.
    if (scrollTarget) {
      if (Math.abs(container.scrollTop - scrollTarget.top) >= 2) return;
      scrollTarget = null;
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    }

    let current: string | null = null;
    for (const group of navGroups) {
      const section = document.getElementById(sectionId(group));
      if (section && sectionTop(container, section) - container.scrollTop <= 96) {
        current = group;
      }
    }
    activeGroup = current ?? navGroups[0] ?? null;
  }

  function jump(group: string): void {
    const container = scroller();
    const section = document.getElementById(sectionId(group));
    if (!container || !section) return;

    const top = Math.max(0, sectionTop(container, section) - 12);
    activeGroup = group;
    scrollTarget = { group, top };
    if (settleTimer) clearTimeout(settleTimer);
    // Fallback for interrupted or instant (reduced-motion) scrolls.
    settleTimer = setTimeout(() => {
      scrollTarget = null;
      updateActive();
    }, 900);
    container.scrollTo({ top, behavior: "smooth" });
  }

  // Track which section is at the top of the settings scroll area.
  $effect(() => {
    const container = scroller();
    if (!container) return;
    const onScroll = () => updateActive();
    container.addEventListener("scroll", onScroll, { passive: true });
    updateActive();
    return () => {
      container.removeEventListener("scroll", onScroll);
      if (settleTimer) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
    };
  });

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

  function confirmReset(): void {
    const target = resetTarget;
    if (!target) return;
    confirmingReset = false;
    void clear(target);
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

  function placeholder(setting: SettingInfo): string {
    if (setting.kind === "secret") return setting.configured ? "•••••• (set)" : "Not set";
    return setting.defaultValue ?? "";
  }
</script>

<Pane variant="detail" title="Settings">
  {#snippet actions()}
    <Button variant="text" onclick={() => void refresh()} disabled={loading}>Reload</Button>
  {/snippet}

  {#snippet activeConnectionRow(
    title: string,
    summary: string,
    connectionId: string,
    options: Array<{ text: string; value: string }>,
    empty: string,
    onchange: (event: Event) => void,
  )}
    <article class="setting">
      <div class="info">
        <div class="name"><span>{title}</span></div>
        <span class="source">{summary}</span>
      </div>
      <div class="control">
        {#if options.length > 0}
          <Select label={title} width="16rem" {options} value={connectionId} {onchange} />
        {:else}
          <p class="muted">{empty}</p>
        {/if}
      </div>
    </article>
  {/snippet}

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else}
    <div class="settings-layout" bind:this={layout}>
      <div class="settings-nav-slot">
      <nav class="settings-nav" aria-label="Settings sections">
        {#each navGroups as group (group)}
            <button
              type="button"
              class="nav-item"
              class:active={activeGroup === group}
              onclick={() => jump(group)}
            >
              {group}
            </button>
          {/each}
        </nav>
      </div>

      <div class="settings-content">
        <section class="group" id={sectionId(DATA_GROUP)}>
          <h3>{DATA_GROUP}</h3>

          <article class="setting">
            <div class="info">
              <div class="name"><span>Import / export configuration</span></div>
              <p class="desc muted">The exported file carries credentials; treat it as a secret.</p>
              {#if importSummary}
                <span class="source">
                  Last import: {importSummary.topics} topic(s), {importSummary.userWorkflows}
                  workflow(s), {importSummary.deliveryChannels} channel(s), {importSummary.jobs}
                  schedule(s), {importSummary.settings} setting(s)
                </span>
              {/if}
            </div>

            <div class="control">
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
            </div>
          </article>
        </section>

        <section class="group" id={sectionId(LLM_GROUP)}>
          <h3>{LLM_GROUP}</h3>

          {@render activeConnectionRow(
            "Active provider",
            activeLlmConnection
              ? llmProviderLabel(activeLlmConnection)
              : "default OpenCode pairing",
            activeLlmConnection?.id ?? "",
            activeLlmOptions,
            "No LLM providers configured.",
            (event) => void chooseActive(LLM_PROVIDER_KEY, event),
          )}

          <ConnectionSection
            settingKey={LLM_PROVIDERS_KEY}
            connections={llmConnections}
            presets={LLM_PROVIDER_PRESETS}
            providerIds={LLM_PROVIDER_IDS}
            noun="LLM provider"
            header="Connections"
            empty="No LLM providers yet."
            icon={iconSmartToy}
            label={llmProviderLabel}
            subtitle={(connection) => connection.baseUrl}
            formOf={(connection) => ({
              provider: connection.provider,
              model: connection.model,
              baseUrl: connection.baseUrl,
              accountId: "",
              apiKey: connection.apiKey ?? "",
            })}
            build={(form, id) => ({
              id,
              provider: form.provider as LlmProviderId,
              model: form.model.trim(),
              baseUrl: form.baseUrl.trim(),
              ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            })}
            verify={(payload) =>
              commands.llm.verify(
                payload as {
                  id?: string;
                  provider?: LlmProviderId;
                  model?: string;
                  baseUrl?: string;
                  apiKey?: string;
                },
              )}
            changed={(setting) =>
              onConnectionsChange(
                setting,
                (value) => parseLlmConnections(value).map((connection) => connection.id),
                LLM_PROVIDER_KEY,
              )}
          />
        </section>

        <section class="group" id={sectionId(DECISION_GROUP)}>
          <h3>{DECISION_GROUP}</h3>

          {@render activeConnectionRow(
            "Active model",
            activeDecisionLabel ?? "local model / LLM fallback",
            activeDecisionId,
            activeDecisionOptions,
            "No hosted models configured.",
            (event) => void chooseActive(DECISION_MODEL_KEY, event),
          )}

          <ConnectionSection
            settingKey={DECISION_MODELS_KEY}
            connections={decisionConnections}
            presets={DECISION_PROVIDER_PRESETS}
            providerIds={DECISION_PROVIDER_IDS}
            noun="decision model"
            header="Hosted connections"
            empty="No hosted decision models yet."
            icon={iconPsychology}
            label={decisionModelLabel}
            subtitle={(connection) =>
              `${connection.baseUrl}${connection.accountId ? ` · account ${connection.accountId}` : ""}`}
            formOf={(connection) => ({
              provider: connection.provider,
              model: connection.model,
              baseUrl: connection.baseUrl,
              accountId: connection.accountId ?? "",
              apiKey: connection.apiKey ?? "",
            })}
            build={(form, id) => ({
              id,
              provider: form.provider as DecisionProviderId,
              model: form.model.trim(),
              baseUrl: form.baseUrl.trim(),
              ...(form.accountId.trim() ? { accountId: form.accountId.trim() } : {}),
              ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            })}
            verify={(payload) =>
              commands.decision.verify(
                payload as {
                  id?: string;
                  provider?: DecisionProviderId;
                  model?: string;
                  baseUrl?: string;
                  accountId?: string;
                  apiKey?: string;
                },
              )}
            changed={(setting) =>
              onConnectionsChange(
                setting,
                (value) => parseDecisionModelConnections(value).map((connection) => connection.id),
                DECISION_MODEL_KEY,
              )}
            removeNote="Decisions fall back to the local model or the LLM."
          />
        </section>

        <section class="group" id={sectionId(SEARCH_GROUP)}>
          <h3>{SEARCH_GROUP}</h3>

          {@render activeConnectionRow(
            "Active provider",
            activeSearchConnection
              ? searchConnectionLabel(activeSearchConnection)
              : "no provider configured",
            activeSearchConnection?.id ?? "",
            activeSearchOptions,
            "No web search providers configured.",
            (event) => void chooseActive(SEARCH_PROVIDER_KEY, event),
          )}

          <ConnectionSection
            settingKey={SEARCH_PROVIDERS_KEY}
            connections={searchConnections}
            presets={SEARCH_PROVIDER_PRESETS}
            providerIds={SEARCH_PROVIDER_IDS}
            noun="web search provider"
            header="Providers"
            empty="No web search providers yet."
            icon={iconSearch}
            uniqueProvider
            allowDuplicate={false}
            label={searchConnectionLabel}
            subtitle={(connection) => connection.baseUrl}
            formOf={(connection) => ({
              provider: connection.provider,
              model: "",
              baseUrl: connection.baseUrl,
              accountId: "",
              apiKey: connection.apiKey ?? "",
            })}
            build={(form, id) => ({
              id,
              provider: form.provider as SearchProviderId,
              baseUrl: form.baseUrl.trim(),
              ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            })}
            verify={(payload) =>
              commands.search.verify(
                payload as {
                  id?: string;
                  provider?: SearchProviderId;
                  baseUrl?: string;
                  apiKey?: string;
                },
              )}
            changed={(setting) =>
              onConnectionsChange(
                setting,
                (value) => parseSearchConnections(value).map((connection) => connection.id),
                SEARCH_PROVIDER_KEY,
              )}
          />
        </section>

        <section class="group" id={sectionId(FINANCE_GROUP)}>
          <h3>{FINANCE_GROUP}</h3>

          <ConnectionSection
            settingKey={FINANCE_PROVIDERS_KEY}
            connections={financeConnections}
            presets={FINANCE_PROVIDER_PRESETS}
            providerIds={FINANCE_PROVIDER_IDS}
            noun="finance provider"
            header="Providers"
            empty="No finance data providers yet."
            icon={iconFinance}
            uniqueProvider
            allowDuplicate={false}
            label={(connection) =>
              FINANCE_PROVIDER_PRESETS[connection.provider]?.label ?? connection.provider}
            subtitle={(connection) =>
              connection.model
                ? `${connection.baseUrl} · ${connection.model}`
                : connection.baseUrl}
            formOf={(connection) => ({
              provider: connection.provider,
              model: connection.model ?? "",
              baseUrl: connection.baseUrl,
              accountId: "",
              apiKey: connection.apiKey ?? "",
            })}
            build={(form, id) => ({
              id,
              provider: form.provider as FinanceProviderId,
              baseUrl: form.baseUrl.trim(),
              ...(form.model.trim() ? { model: form.model.trim() } : {}),
              ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
            })}
            verify={(payload) =>
              commands.finance.verify(
                payload as {
                  id?: string;
                  provider?: FinanceProviderId;
                  baseUrl?: string;
                  model?: string;
                  apiKey?: string;
                },
              )}
            changed={onConnectionChange}
          />
        </section>

        {#each genericGroups as group (group)}
          <section class="group" id={sectionId(group)}>
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
              {:else if setting.kind === "secret"}
                <SecretField
                  label="Value"
                  placeholder={placeholder(setting)}
                  disabled={setting.source === "env"}
                  bind:value={drafts[setting.key]}
                  enter={() => void save(setting)}
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
                    onclick={() => {
                      resetTarget = setting;
                      confirmingReset = true;
                    }}
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
      </div>
    </div>
  {/if}

  <ConfirmDeleteDialog
    bind:open={confirmingReset}
    headline="Reset this setting?"
    message={`The stored value for "${resetTarget?.label}" will be deleted, so its default or environment value applies again.`}
    confirmLabel="Reset"
    onconfirm={confirmReset}
    oncancel={() => (confirmingReset = false)}
  />
</Pane>

<style>
  /* The nav is absolutely placed inside the reserved left padding, so it can
     never overlap the settings content, whatever the width math does. The
     inner nav sticks while its full-height slot scrolls past. */
  .settings-layout {
    position: relative;
    padding-left: calc(12rem + var(--space-large));
  }

  .settings-nav-slot {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 12rem;
  }

  .settings-nav {
    position: sticky;
    top: 0;
    box-sizing: border-box;
    width: 12rem;
    display: flex;
    flex-direction: column;
    /* Same gap on both sides of the nav. */
    padding-right: var(--space-large);
  }

  .nav-item {
    display: block;
    width: 100%;
    padding: var(--space-medium) var(--space-medium);
    border: none;
    border-radius: var(--m3-shape-small);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    font: inherit;
    font-size: var(--font-medium);
    line-height: 1.35;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    cursor: pointer;
  }

  .nav-item:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .nav-item.active {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .settings-content {
    display: flex;
    flex-direction: column;
    gap: var(--space-large);
    flex: 1 1 auto;
    min-width: 0;
  }

  @media (max-width: 720px) {
    .settings-layout {
      padding-left: 0;
    }

    .settings-nav-slot {
      position: static;
      width: 100%;
    }

    .settings-nav {
      position: static;
      width: 100%;
      flex-direction: row;
      flex-wrap: wrap;
      padding: 0 0 var(--space-medium);
    }

    .nav-item {
      width: auto;
    }
  }

  /* Each section is its own card, so a section boundary is always visible. */
  .group {
    box-sizing: border-box;
    max-width: 60rem;
    padding: var(--space-medium) var(--space-large);
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-large);
    background-color: var(--m3c-surface-container-low);
    box-shadow: var(--m3-elevation-1);
  }

  .group h3 {
    @apply --m3-title-small;
    margin: 0 0 var(--space-small);
    padding: 0 0 var(--space-small);
    border-bottom: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface);
  }

  .setting {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-large);
    padding: var(--space-medium) 0;
  }

  .setting + .setting {
    border-top: 1px solid var(--m3c-outline-variant);
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

  .override {
    display: inline-flex;
    color: var(--m3c-warning);
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

  .control {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: var(--space-small);
    flex: 0 0 auto;
  }

  .buttons {
    display: flex;
    align-items: center;
    gap: var(--space-small);
  }

  .file {
    display: none;
  }
</style>
