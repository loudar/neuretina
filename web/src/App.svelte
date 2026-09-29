<script lang="ts">
  import { onMount } from "svelte";
  import { Chip, Icon, Snackbar, Tabs } from "m3-svelte";
  import iconCheck from "@ktibow/iconset-material-symbols/check-circle";
  import iconError from "@ktibow/iconset-material-symbols/error";
  import iconSync from "@ktibow/iconset-material-symbols/sync";
  import { commands, type AppConfigInfo } from "./lib/api";
  import { eventStream } from "./lib/events.svelte";
  import BriefsPanel from "./components/BriefsPanel.svelte";
  import TopicsPanel from "./components/TopicsPanel.svelte";
  import JobsPanel from "./components/JobsPanel.svelte";
  import EventLog from "./components/EventLog.svelte";

  let tab = $state("briefs");
  let config = $state<AppConfigInfo | null>(null);

  const tabs = [
    { name: "Briefs", value: "briefs" },
    { name: "Topics", value: "topics" },
    { name: "Scheduled tasks", value: "jobs" },
    { name: "Live events", value: "events" },
  ];

  const integrations = $derived(
    config
      ? [
          { label: "LLM", ok: config.integrations.llm },
          { label: "Web search", ok: config.integrations.perplexity },
          { label: "Bluesky", ok: config.integrations.bluesky === "authenticated" },
          { label: "Speech", ok: config.integrations.elevenlabs },
          { label: "Matrix", ok: config.integrations.matrix },
        ]
      : [],
  );

  onMount(() => {
    eventStream.start();
    void commands
      .config()
      .then((loaded) => (config = loaded))
      .catch(() => {
        config = null;
      });
    return () => eventStream.stop();
  });
</script>

<div class="app stack">
  <div class="toolbar">
    <h2>Briefing Engine</h2>
    <div class="chips">
      <Chip variant="assist" icon={eventStream.connected ? iconCheck : iconSync}>
        Events {eventStream.connected ? "live" : "reconnecting"}
      </Chip>
      {#each integrations as integration (integration.label)}
        <Chip variant="assist" icon={integration.ok ? iconCheck : iconError}>
          {integration.label}
        </Chip>
      {/each}
    </div>
  </div>

  <Tabs bind:tab items={tabs} />

  {#if tab === "briefs"}
    <BriefsPanel />
  {:else if tab === "topics"}
    <TopicsPanel />
  {:else if tab === "jobs"}
    <JobsPanel defaultCron={config?.defaults.briefCron} />
  {:else}
    <EventLog />
  {/if}
</div>

<Snackbar />
