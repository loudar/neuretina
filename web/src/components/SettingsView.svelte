<script lang="ts">
  import { onMount } from "svelte";
  import { Button } from "m3-svelte";
  import type { SettingInfo } from "../lib/api";
  import {
    parseDecisionModelConnections,
    parseFinanceConnections,
    parseLlmConnections,
    parseSearchConnections,
  } from "../lib/api";
  import { commands } from "../lib/commands";
  import { configState } from "../lib/config.svelte";
  import { reportError, reportSuccess } from "../lib/feedback";
  import {
    DECISION_CONNECTION_GROUP,
    FINANCE_CONNECTION_GROUP,
    LLM_CONNECTION_GROUP,
    SEARCH_CONNECTION_GROUP,
  } from "../lib/settingsConnections";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import Pane from "./Pane.svelte";
  import SettingsConnectionGroup from "./SettingsConnectionGroup.svelte";
  import SettingsDataSection from "./SettingsDataSection.svelte";
  import SettingsGenericSection from "./SettingsGenericSection.svelte";
  import SettingsNav from "./SettingsNav.svelte";

  const DATA_GROUP = "Data transfer";
  const customGroups = [
    LLM_CONNECTION_GROUP.group,
    DECISION_CONNECTION_GROUP.group,
    SEARCH_CONNECTION_GROUP.group,
    FINANCE_CONNECTION_GROUP.group,
  ];

  let settings = $state<SettingInfo[]>([]);
  let drafts = $state<Record<string, string>>({});
  let loading = $state(true);
  let busy = $state<string | null>(null);
  let resetTarget = $state<SettingInfo | null>(null);
  let confirmingReset = $state(false);

  const groups = $derived([...new Set(settings.map((setting) => setting.group))]);
  const genericGroups = $derived(groups.filter((group) => !customGroups.includes(group)));
  const navGroups = $derived([DATA_GROUP, ...customGroups, ...genericGroups]);

  function settingValue(key: string): string | null {
    return settings.find((entry) => entry.key === key)?.value ?? null;
  }

  // Dynamic connection lists; the shared section stores them as JSON settings
  // so they travel with configuration exports.
  const llmConnections = $derived(parseLlmConnections(settingValue(LLM_CONNECTION_GROUP.settingKey)));
  const decisionConnections = $derived(
    parseDecisionModelConnections(settingValue(DECISION_CONNECTION_GROUP.settingKey)),
  );
  const searchConnections = $derived(
    parseSearchConnections(settingValue(SEARCH_CONNECTION_GROUP.settingKey)),
  );
  const financeConnections = $derived(
    parseFinanceConnections(settingValue(FINANCE_CONNECTION_GROUP.settingKey)),
  );

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

  // ── Section navigation ───────────────────────────────────────────────────

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

  // ── Settings reads and writes ────────────────────────────────────────────

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

  function apply(setting: SettingInfo): void {
    settings = settings.map((entry) => (entry.key === setting.key ? setting : entry));
    drafts[setting.key] = setting.value ?? "";
  }

  async function save(setting: SettingInfo): Promise<void> {
    busy = setting.key;
    try {
      apply(await commands.settings.set(setting.key, drafts[setting.key] ?? ""));
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
</script>

<Pane variant="detail" title="Settings">
  {#snippet actions()}
    <Button variant="text" onclick={() => void refresh()} disabled={loading}>Reload</Button>
  {/snippet}

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else}
    <div class="settings-layout" bind:this={layout}>
      <SettingsNav groups={navGroups} active={activeGroup} onjump={jump} />

      <div class="settings-content">
        <SettingsDataSection group={DATA_GROUP} id={sectionId(DATA_GROUP)} onimported={refresh} />

        <SettingsConnectionGroup
          config={LLM_CONNECTION_GROUP}
          id={sectionId(LLM_CONNECTION_GROUP.group)}
          connections={llmConnections}
          activeValue={settingValue(LLM_CONNECTION_GROUP.activeKey ?? "")}
          onapply={apply}
          onactivechange={(event) => void chooseActive(LLM_CONNECTION_GROUP.activeKey ?? "", event)}
        />
        <SettingsConnectionGroup
          config={DECISION_CONNECTION_GROUP}
          id={sectionId(DECISION_CONNECTION_GROUP.group)}
          connections={decisionConnections}
          activeValue={settingValue(DECISION_CONNECTION_GROUP.activeKey ?? "")}
          onapply={apply}
          onactivechange={(event) =>
            void chooseActive(DECISION_CONNECTION_GROUP.activeKey ?? "", event)}
        />
        <SettingsConnectionGroup
          config={SEARCH_CONNECTION_GROUP}
          id={sectionId(SEARCH_CONNECTION_GROUP.group)}
          connections={searchConnections}
          activeValue={settingValue(SEARCH_CONNECTION_GROUP.activeKey ?? "")}
          onapply={apply}
          onactivechange={(event) =>
            void chooseActive(SEARCH_CONNECTION_GROUP.activeKey ?? "", event)}
        />
        <SettingsConnectionGroup
          config={FINANCE_CONNECTION_GROUP}
          id={sectionId(FINANCE_CONNECTION_GROUP.group)}
          connections={financeConnections}
          onapply={apply}
        />

        {#each genericGroups as group (group)}
          <SettingsGenericSection
            {group}
            id={sectionId(group)}
            settings={inGroup(group)}
            {drafts}
            {busy}
            onsave={(setting) => void save(setting)}
            onclear={(setting) => {
              resetTarget = setting;
              confirmingReset = true;
            }}
            ontoggle={(setting, checked) => void toggle(setting, checked)}
            onchoose={(setting, event) => void choose(setting, event)}
          />
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
     never overlap the settings content, whatever the width math does. */
  .settings-layout {
    position: relative;
    padding-left: calc(12rem + var(--space-large));
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
  }
</style>
