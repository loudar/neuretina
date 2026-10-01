<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { Chip, Icon, NavigationRail, NavigationRailItem, Snackbar } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconCategory from "@ktibow/iconset-material-symbols/category";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconHistory from "@ktibow/iconset-material-symbols/history";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconLogout from "@ktibow/iconset-material-symbols/logout";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import iconSend from "@ktibow/iconset-material-symbols/send";
  import iconSettings from "@ktibow/iconset-material-symbols/settings";
  import iconWarning from "@ktibow/iconset-material-symbols/warning";
  import { eventStream } from "./lib/events.svelte";
  import { statusFeed } from "./lib/statuses.svelte";
  import { configState } from "./lib/config.svelte";
  import { mountHoverPopovers } from "./lib/hoverPopover";
  import { authState } from "./lib/auth.svelte";
  import { paths, router } from "./lib/router.svelte";
  import BriefsView from "./components/BriefsView.svelte";
  import LoginView from "./components/LoginView.svelte";
  import SharedBriefView from "./components/SharedBriefView.svelte";
  import TopicsView from "./components/TopicsView.svelte";
  import JobsView from "./components/JobsView.svelte";
  import WorkflowsView from "./components/WorkflowsView.svelte";
  import DeliveryView from "./components/DeliveryView.svelte";
  import ArtifactsView from "./components/ArtifactsView.svelte";
  import EventsView from "./components/EventsView.svelte";
  import SettingsView from "./components/SettingsView.svelte";

  const tab = $derived(router.current.tab);
  const config = $derived(configState.value);

  // A delivery link carries a brief's anonymous token; without a session it
  // renders as a bare read-only view instead of the login gate.
  const sharedToken = $derived(
    router.current.tab === "briefs" ? (router.current.query.token ?? null) : null,
  );

  const nav = [
    { label: "Briefs", value: "briefs", icon: iconArticle },
    { label: "Topics", value: "topics", icon: iconLabel },
    { label: "Scheduled tasks", value: "jobs", icon: iconSchedule },
    { label: "Workflows", value: "workflows", icon: iconBolt },
    { label: "Delivery", value: "delivery", icon: iconSend },
    { label: "Artifacts", value: "artifacts", icon: iconCategory },
    { label: "Live events", value: "events", icon: iconHistory },
    { label: "Settings", value: "settings", icon: iconSettings },
  ] as const;

  const integrations = $derived(
    config
      ? [
          { label: "LLM", ok: config.integrations.llm },
          { label: "Web search", ok: config.integrations.perplexity },
          { label: "Bluesky", ok: config.integrations.bluesky === "authenticated" },
          { label: "Speech", ok: config.integrations.tts },
          { label: "Matrix", ok: config.integrations.matrix },
        ]
      : [],
  );

  // One pill for the whole engine: green when the event stream is live and
  // every integration is configured, amber when the stream is live but some
  // integrations are missing, red when the event stream is down.
  const health = $derived.by(() => {
    const down = integrations.filter((integration) => !integration.ok).map((i) => i.label);
    if (!config) {
      return { state: "connecting" as const, label: "Connecting…", detail: "Waiting for the engine" };
    }
    if (!eventStream.connected) {
      return {
        state: "down" as const,
        label: "Offline",
        detail: "Live event stream disconnected",
      };
    }
    if (down.length > 0) {
      return {
        state: "partial" as const,
        label: "Partial",
        detail: `Not configured: ${down.join(", ")}`,
      };
    }
    return {
      state: "up" as const,
      label: "Online",
      detail: "All integrations configured, events live",
    };
  });

  const healthTone = $derived(
    health.state === "up"
      ? "tone-success"
      : health.state === "partial"
        ? "tone-warning"
        : health.state === "down"
          ? "tone-error"
          : "",
  );

  // The backend rejects every data call until the site is unlocked, so the
  // feeds only run while a session exists. The calls are untracked: starting
  // the event stream reads its cursor state, and tracking that would restart
  // both feeds on every event batch.
  $effect(() => {
    const locked = authState.loading || authState.locked;
    untrack(() => {
      if (locked) {
        eventStream.stop();
        statusFeed.stop();
        return;
      }
      eventStream.start();
      statusFeed.start();
      void configState.load();
    });
    return () =>
      untrack(() => {
        eventStream.stop();
        statusFeed.stop();
      });
  });

  onMount(() => {
    void authState.load();
    const stopHoverPopovers = mountHoverPopovers();
    return () => {
      eventStream.stop();
      statusFeed.stop();
      stopHoverPopovers();
    };
  });
</script>

{#if authState.loading}
  <div class="boot"><p class="muted">Loading…</p></div>
{:else if authState.locked}
  {#if sharedToken}
    <SharedBriefView token={sharedToken} />
  {:else}
    <LoginView />
  {/if}
{:else}
<div class="shell">
  <NavigationRail collapse="no" open>
    {#snippet fab()}
      <div class="brand">
        <h2>Neuretina</h2>
      </div>
    {/snippet}

    {#each nav as item (item.value)}
      <NavigationRailItem
        label={item.label}
        icon={item.icon}
        active={tab === item.value}
        onclick={() => router.navigate(paths.tab(item.value))}
      />
    {/each}

    <div class="rail-footer">
      <span class="health {healthTone}" title={health.detail}>
        <Chip
          variant="assist"
          icon={health.state === "up"
            ? iconCheck
            : health.state === "partial"
              ? iconWarning
              : iconError}
        >
          {health.label}
        </Chip>
      </span>
      {#if authState.enabled}
        <div class="account">
          {#if authState.status?.subject}
            <span class="username" title={authState.status.subject}>
              {authState.status.subject}
            </span>
          {/if}
          <button
            type="button"
            class="logout"
            title="Log out"
            onclick={() => void authState.logout()}
          >
            <Icon icon={iconLogout} size={18} />
          </button>
        </div>
      {/if}
    </div>
  </NavigationRail>

  {#if tab === "briefs"}
    <BriefsView />
  {:else if tab === "topics"}
    <TopicsView />
  {:else if tab === "jobs"}
    <JobsView defaultCron={config?.defaults.briefCron} />
  {:else if tab === "workflows"}
    <WorkflowsView />
  {:else if tab === "delivery"}
    <DeliveryView />
  {:else if tab === "artifacts"}
    <ArtifactsView />
  {:else if tab === "settings"}
    <SettingsView />
  {:else}
    <EventsView />
  {/if}
</div>
{/if}

<Snackbar />

<style>
  .boot {
    display: grid;
    place-items: center;
    height: 100dvh;
  }

  .shell {
    display: flex;
    height: 100dvh;
    overflow: hidden;
  }

  /* The M3 rail reserves 44/56px; tighten it to align the pill with the items. */
  /* Structural: the brand's -2rem margin cancels this padding so the header
     line lands exactly on the pane header line. */
  .shell :global(.rail.rail) {
    padding-top: 2rem;
    padding-bottom: 1.25rem;
  }

  /* Matches the pane headings: same height, type and hairline, with the
     negative margins cancelling the rail padding so the line continues.
     The rail lives in an .m3-container, which forces border-box sizing; the
     panes are content-box, so opt out to keep the same total height. */
  .brand {
    box-sizing: content-box;
    display: flex;
    align-items: center;
    height: 3.5rem;
    margin: -2rem -20px 0;
    padding: 0 20px;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .brand h2 {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.4;
  }

  .rail-footer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    margin-top: auto;
    padding: 0 20px;
  }

  .health :global(button.m3-container) {
    border-color: transparent;
  }

  .account {
    display: flex;
    align-items: center;
    gap: var(--space-small);
    max-width: 100%;
    margin-top: var(--space-small);
  }

  .username {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--m3c-on-surface-variant);
    font-size: 0.78rem;
  }

  .logout {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 2.2rem;
    height: 2.2rem;
    padding: 0;
    border: none;
    border-radius: var(--m3-shape-full);
    background: transparent;
    color: var(--m3c-on-surface-variant);
    cursor: pointer;
  }

  .logout:hover {
    background-color: var(--m3c-surface-container-high);
  }
</style>
