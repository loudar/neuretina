<script lang="ts">
  import { onMount } from "svelte";
  import { Chip, NavigationRail, NavigationRailItem, Snackbar } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconCategory from "@ktibow/iconset-material-symbols/category";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconHistory from "@ktibow/iconset-material-symbols/history";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import iconSettings from "@ktibow/iconset-material-symbols/settings";
  import iconWarning from "@ktibow/iconset-material-symbols/warning";
  import { eventStream } from "./lib/events.svelte";
  import { statusFeed } from "./lib/statuses.svelte";
  import { configState } from "./lib/config.svelte";
  import { paths, router } from "./lib/router.svelte";
  import BriefsView from "./components/BriefsView.svelte";
  import TopicsView from "./components/TopicsView.svelte";
  import JobsView from "./components/JobsView.svelte";
  import WorkflowsView from "./components/WorkflowsView.svelte";
  import ArtifactsView from "./components/ArtifactsView.svelte";
  import EventsView from "./components/EventsView.svelte";
  import SettingsView from "./components/SettingsView.svelte";

  const tab = $derived(router.current.tab);
  const config = $derived(configState.value);

  const nav = [
    { label: "Briefs", value: "briefs", icon: iconArticle },
    { label: "Topics", value: "topics", icon: iconLabel },
    { label: "Scheduled tasks", value: "jobs", icon: iconSchedule },
    { label: "Workflows", value: "workflows", icon: iconBolt },
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

  onMount(() => {
    eventStream.start();
    statusFeed.start();
    void configState.load();
    return () => {
      eventStream.stop();
      statusFeed.stop();
    };
  });
</script>

<div class="shell">
  <NavigationRail collapse="no" open>
    {#snippet fab()}
      <div class="brand">
        <h2>Briefing Engine</h2>
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
      <span class="health {health.state}" title={health.detail}>
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
  {:else if tab === "artifacts"}
    <ArtifactsView />
  {:else if tab === "settings"}
    <SettingsView />
  {:else}
    <EventsView />
  {/if}
</div>

<Snackbar />

<style>
  .shell {
    display: flex;
    height: 100dvh;
    overflow: hidden;
  }

  /* The M3 rail reserves 44/56px; tighten it to align the pill with the items. */
  .shell :global(.rail.rail) {
    padding-top: 2rem;
    padding-bottom: 1.25rem;
  }

  .brand {
    display: flex;
    flex-direction: column;
    padding-bottom: 0.25rem;
  }

  .brand h2 {
    font-size: 1.05rem;
    line-height: 1.25;
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

  .health.up :global(button.m3-container) {
    background-color: light-dark(#e7f4ea, #22392a);
    color: light-dark(#1f6f36, #a9d9b4);
  }

  .health.up :global(button.m3-container .leading) {
    color: inherit;
  }

  .health.partial :global(button.m3-container) {
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .health.partial :global(button.m3-container .leading) {
    color: inherit;
  }

  .health.down :global(button.m3-container) {
    background-color: var(--m3c-error-container);
    color: var(--m3c-on-error-container);
  }

  .health.down :global(button.m3-container .leading) {
    color: inherit;
  }
</style>
