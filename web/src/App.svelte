<script lang="ts">
  import { onMount } from "svelte";
  import { Chip, NavigationRail, NavigationRailItem, Snackbar } from "m3-svelte";
  import iconArticle from "@ktibow/iconset-material-symbols/article";
  import iconBolt from "@ktibow/iconset-material-symbols/bolt";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconHistory from "@ktibow/iconset-material-symbols/history";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconSchedule from "@ktibow/iconset-material-symbols/schedule";
  import { commands, type AppConfigInfo } from "./lib/api";
  import { eventStream } from "./lib/events.svelte";
  import { statusFeed } from "./lib/statuses.svelte";
  import BriefsView from "./components/BriefsView.svelte";
  import TopicsView from "./components/TopicsView.svelte";
  import JobsView from "./components/JobsView.svelte";
  import WorkflowsView from "./components/WorkflowsView.svelte";
  import EventsView from "./components/EventsView.svelte";

  let tab = $state("briefs");
  let config = $state<AppConfigInfo | null>(null);

  const nav = [
    { label: "Briefs", value: "briefs", icon: iconArticle },
    { label: "Topics", value: "topics", icon: iconLabel },
    { label: "Scheduled tasks", value: "jobs", icon: iconSchedule },
    { label: "Workflows", value: "workflows", icon: iconBolt },
    { label: "Live events", value: "events", icon: iconHistory },
  ];

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

  // One pill for the whole engine: green when everything is up, red otherwise.
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
        state: "down" as const,
        label: "Offline",
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
    void commands
      .config()
      .then((loaded) => (config = loaded))
      .catch(() => {
        config = null;
      });
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
        <small class="muted">build {new Date(__BUILD_STAMP__).toLocaleString()}</small>
      </div>
    {/snippet}

    {#each nav as item (item.value)}
      <NavigationRailItem
        label={item.label}
        icon={item.icon}
        active={tab === item.value}
        onclick={() => (tab = item.value)}
      />
    {/each}

    <div class="rail-footer">
      <span class="health {health.state}" title={health.detail}>
        <Chip variant="assist" icon={health.state === "up" ? iconCheck : iconError}>
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

  .brand {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding-bottom: 0.25rem;
  }

  .brand h2 {
    font-size: 1.05rem;
    line-height: 1.25;
  }

  .brand small {
    font-size: 0.7rem;
    line-height: 1.3;
  }

  .rail-footer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.4rem;
    margin-top: auto;
    padding: 0 1rem 0.5rem;
  }

  .health :global(button.m3-container) {
    border-color: transparent;
  }

  .health.up :global(button.m3-container) {
    background-color: #2e7d32;
    color: #ffffff;
  }

  .health.up :global(button.m3-container .leading) {
    color: #ffffff;
  }

  .health.down :global(button.m3-container) {
    background-color: var(--m3c-error);
    color: var(--m3c-on-error);
  }

  .health.down :global(button.m3-container .leading) {
    color: var(--m3c-on-error);
  }
</style>
