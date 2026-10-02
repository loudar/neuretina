<script lang="ts">
  import { Button, Dialog, Switch } from "m3-svelte";
  import type { DeliveryChannelInfo, Report } from "../lib/api";
  import { commands } from "../lib/commands";
  import { reportError, reportSuccess } from "../lib/feedback";

  interface Props {
    report: Report | null;
    open: boolean;
  }

  let { report, open = $bindable() }: Props = $props();

  let channels = $state<DeliveryChannelInfo[]>([]);
  let selected = $state<string[]>([]);
  let loading = $state(false);
  let sending = $state(false);

  // Re-send targets the channels currently attached to the report's workflow;
  // this dialog picks a subset of them per send.
  $effect(() => {
    if (!open || !report) return;
    const target = report;
    let cancelled = false;
    channels = [];
    selected = [];
    loading = true;
    void (async () => {
      try {
        const [all, deliveryWorkflows] = await Promise.all([
          commands.delivery.channels(),
          commands.delivery.workflows(),
        ]);
        if (cancelled) return;
        const attached = deliveryWorkflows.find((entry) => entry.workflow === target.workflow);
        const attachedChannels = attached
          ? all.filter((channel) => attached.channelIds.includes(channel.id))
          : [];
        channels = attachedChannels;
        selected = attachedChannels.slice(0, 1).map((channel) => channel.id);
      } catch (error) {
        if (!cancelled) reportError(error);
      } finally {
        if (!cancelled) loading = false;
      }
    })();
    return () => {
      cancelled = true;
    };
  });

  function toggle(id: string): void {
    selected = selected.includes(id)
      ? selected.filter((entry) => entry !== id)
      : [...selected, id];
  }

  async function send(): Promise<void> {
    if (!report || sending || selected.length === 0) return;
    sending = true;
    try {
      const result = await commands.reports.send(report.id, selected);
      const sent = result.results.filter((entry) => entry.status === "sent").length;
      const failed = result.results.length - sent;
      if (sent === 0) {
        reportError(`Report delivery failed on all ${failed} channel(s)`);
      } else {
        reportSuccess(`Report sent to ${sent} channel(s)${failed > 0 ? `, ${failed} failed` : ""}`);
      }
      open = false;
    } catch (error) {
      reportError(error);
    } finally {
      sending = false;
    }
  }
</script>

<Dialog headline="Re-send this report?" bind:open>
  <p>
    Deliver "{report?.topics.join(", ") || "Untitled report"}" to the selected delivery channels.
  </p>
  {#if loading}
    <p class="muted">Loading channels…</p>
  {:else if channels.length === 0}
    <p class="muted">No delivery channels attached to this workflow.</p>
  {:else}
    <div class="channels">
      {#each channels as channel (channel.id)}
        <label class="channel" title={channel.enabled ? "" : "This channel is disabled"}>
          <Switch checked={selected.includes(channel.id)} onchange={() => toggle(channel.id)} />
          <span>{channel.name}{channel.enabled ? "" : " (disabled)"}</span>
          <span class="provider-tag" data-provider={channel.type}>{channel.type}</span>
        </label>
      {/each}
    </div>
  {/if}
  {#snippet buttons()}
    <Button variant="text" onclick={() => (open = false)} disabled={sending}>Cancel</Button>
    <Button variant="filled" onclick={() => void send()} disabled={sending || selected.length === 0}>
      {sending ? "Sending…" : "Send"}
    </Button>
  {/snippet}
</Dialog>

<style>
  .channels {
    display: flex;
    flex-direction: column;
    gap: var(--space-small);
  }

  .channel {
    display: inline-flex;
    align-items: center;
    gap: var(--space-small);
    cursor: pointer;
    user-select: none;
  }
</style>
