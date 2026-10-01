<script lang="ts">
  import { onMount } from "svelte";
  import { Button, Dialog, Icon, Select, Switch, TextFieldOutlined } from "m3-svelte";
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
  let resetTarget = $state<SettingInfo | null>(null);
  let confirmingReset = $state(false);

  const groups = $derived([...new Set(settings.map((setting) => setting.group))]);

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
    for (const group of groups) {
      const section = document.getElementById(sectionId(group));
      if (section && sectionTop(container, section) - container.scrollTop <= 96) {
        current = group;
      }
    }
    activeGroup = current ?? groups[0] ?? null;
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

  {#if loading}
    <p class="muted">Loading settings…</p>
  {:else}
    <div class="settings-layout" bind:this={layout}>
      <div class="settings-nav-slot">
        <nav class="settings-nav" aria-label="Settings sections">
          {#each groups as group (group)}
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
        {#each groups as group (group)}
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

  <Dialog headline="Reset this setting?" bind:open={confirmingReset}>
    <p>
      The stored value for "{resetTarget?.label}" will be deleted, so its default or environment
      value applies again.
    </p>
    {#snippet buttons()}
      <Button variant="text" onclick={() => (confirmingReset = false)}>Cancel</Button>
      <span class="danger">
        <Button variant="filled" onclick={confirmReset}>Reset</Button>
      </span>
    {/snippet}
  </Dialog>
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
    padding: var(--space-small) var(--space-medium);
    border: none;
    border-radius: var(--m3-shape-small);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    font: inherit;
    font-size: 0.85rem;
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

  .group {
    max-width: 60rem;
    margin-bottom: var(--space-large);
  }

  .group h3 {
    @apply --m3-title-small;
    margin: 0 0 var(--space-small);
    color: var(--m3c-on-surface-variant);
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

  .source.env {
    color: var(--m3c-warning);
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
</style>
