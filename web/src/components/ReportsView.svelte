<script lang="ts">
  import { Button, Icon } from "m3-svelte";
  import iconLabel from "@ktibow/iconset-material-symbols/label";
  import iconLink from "@ktibow/iconset-material-symbols/link";
  import iconMic from "@ktibow/iconset-material-symbols/mic";
  import iconMicOff from "@ktibow/iconset-material-symbols/mic-off";
  import iconSend from "@ktibow/iconset-material-symbols/send";
  import { commands } from "../lib/commands";
  import type { Report } from "../lib/api";
  import { copyText } from "../lib/clipboard";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { formatDateTime, formatRelativeTime } from "../lib/format";
  import { reportTitle } from "../lib/reports";
  import { useRefresh } from "../lib/refresh.svelte";
  import { paths, router } from "../lib/router.svelte";
  import DataList from "./DataList.svelte";
  import DeleteIconButton from "./DeleteIconButton.svelte";
  import ConfirmDeleteDialog from "./ConfirmDeleteDialog.svelte";
  import MarkdownView from "./MarkdownView.svelte";
  import Pane from "./Pane.svelte";
  import ResendReportDialog from "./ResendReportDialog.svelte";
  import TimelineView from "./TimelineView.svelte";

  let reports = $state<Report[]>([]);
  let selected = $state<Report | null>(null);
  let audioUrl = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleting = $state(false);
  let generating = $state(false);

  let resendOpen = $state(false);

  const route = $derived(router.current);
  const reportId = $derived(route.segments[0] ?? null);

  // The source filter lives in `?source=`; typing rewrites the current
  // history entry so back/forward are not flooded with filter states.
  let sourceFilter = $state(route.query.source ?? "");
  $effect(() => {
    const query = route.query.source ?? "";
    if (query !== sourceFilter) sourceFilter = query;
  });

  function setSourceFilter(value: string): void {
    sourceFilter = value;
    router.navigate(paths.reports(reportId, { source: value.trim() || undefined }), { replace: true });
  }

  async function refreshList(): Promise<void> {
    try {
      reports = await commands.reports.list();
    } catch (error) {
      reportError(error);
    }
  }

  async function loadReport(id: string): Promise<void> {
    try {
      const report = await commands.reports.get(id);
      if (reportId !== id) return;
      selected = report;
      audioUrl = null;

      // The artifacts come with the report, in display order; only the audio
      // bytes need a separate fetch.
      const audio = report.hasAudio ? await commands.reports.audio(id) : null;
      if (reportId !== id) return;
      audioUrl = audio?.dataUrl ?? null;
    } catch (error) {
      reportError(error);
    }
  }

  // The URL owns the selection: /reports/<id> loads the report, /reports clears it.
  $effect(() => {
    const id = reportId;
    if (!id) {
      selected = null;
      audioUrl = null;
      return;
    }
    void loadReport(id);
  });

  async function copyLink(): Promise<void> {
    if (!selected) return;
    try {
      const { url } = await commands.reports.share(selected.id);
      const absolute = /^https?:\/\//.test(url) ? url : `${window.location.origin}${url}`;
      await copyText(absolute);
      reportSuccess("Public link copied");
    } catch (error) {
      reportError(error);
    }
  }

  async function generateVoice(): Promise<void> {
    if (!selected || generating) return;
    generating = true;
    try {
      const result = await commands.reports.generateAudio(selected.id);
      reportSuccess(
        `Voice generated (${Math.round(result.bytes / 1024)} KB) and sent to Matrix`,
      );
    } catch (error) {
      reportError(error);
    } finally {
      generating = false;
    }
  }

  async function deleteSelected(): Promise<void> {
    if (!selected || deleting) return;
    const target = selected;
    deleting = true;
    router.navigate(paths.reports());
    try {
      await commands.reports.remove(target.id);
      confirmingDelete = false;
      reportSuccess("Report deleted");
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }

  useRefresh(
    ["report.generated", "tts.synthesized", "message.voice.sent", "report.deleted", "artifact.deleted"],
    async () => {
      await refreshList();
      if (!reportId) return;
      // The open report may have been deleted (here or elsewhere).
      if (!reports.some((report) => report.id === reportId)) {
        router.navigate(paths.reports(), { replace: true });
        return;
      }
      await loadReport(reportId);
    },
  );
</script>

<Pane variant="list" title="Reports">
  <DataList items={reports} empty="No reports yet. They appear when a report workflow runs.">
    {#snippet children(report)}
      <div class="entry" class:selected={selected?.id === report.id}>
        <button type="button" class="report-row" onclick={() => router.navigate(paths.reports(report.id))}>
          <span class="report-title">{reportTitle(report)}</span>
          <span class="badges">
            <span class="badge topics" title={`${report.topics.length} topic(s)`}>
              <Icon icon={iconLabel} size={14} />{report.topics.length}
            </span>
            <span class="badge sources" title={`${report.sources.length} source(s)`}>
              <Icon icon={iconLink} size={14} />{report.sources.length}
            </span>
            <span
              class="badge audio"
              class:has-audio={report.hasAudio}
              title={report.hasAudio ? "Voice message available" : "Text only — no audio"}
            >
              <Icon icon={report.hasAudio ? iconMic : iconMicOff} size={14} />{report.hasAudio
                ? "audio"
                : "text"}
            </span>
          </span>
        </button>
      </div>
    {/snippet}
  </DataList>
</Pane>

<Pane
  variant="detail"
  title={selected ? reportTitle(selected) : "Report details"}
  subtitle={selected
    ? `${formatRelativeTime(selected.createdAt)}${selected.audioDurationMs
        ? ` · ${Math.round(selected.audioDurationMs / 1000)}s audio`
        : ""}`
    : undefined}
>
  {#snippet actions()}
    {#if selected}
      {#if !selected.hasAudio}
        <Button variant="tonal" iconType="left" onclick={generateVoice} disabled={generating}>
          <Icon icon={iconMic} /> {generating ? "Generating…" : "Generate voice"}
        </Button>
      {/if}
      <Button
        variant="tonal"
        iconType="left"
        onclick={() => void copyLink()}
        title="Copy the anonymous read-only link"
      >
        <Icon icon={iconLink} /> Copy link
      </Button>
      <Button variant="tonal" iconType="left" onclick={() => (resendOpen = true)}>
        <Icon icon={iconSend} /> Re-send
      </Button>
      <DeleteIconButton onclick={() => (confirmingDelete = true)} disabled={deleting} />
    {/if}
  {/snippet}

  {#if selected}
    <div class="report-body">
      {#each selected.artifacts as artifact (artifact.id)}
        {#if artifact.kind === "timeline"}
          <div class="timeline">
            <TimelineView {artifact} />
          </div>
        {:else if artifact.kind === "audio"}
          {#if audioUrl}
            <audio controls src={audioUrl}></audio>
          {:else}
            <p class="muted">Loading audio…</p>
          {/if}
        {:else if artifact.kind === "report-text"}
          <MarkdownView
            markdown={selected.markdown}
            sources={selected.sources}
            filter={sourceFilter}
            onfilter={setSourceFilter}
          />
        {/if}
      {/each}
    </div>
  {:else}
    <p class="muted">Select a report to read it and play the audio.</p>
  {/if}

  <ResendReportDialog report={selected} bind:open={resendOpen} />

  <ConfirmDeleteDialog
    bind:open={confirmingDelete}
    headline="Delete this report?"
    message={`"${selected?.topics.join(", ") || "Untitled report"}" from ${formatDateTime(
      selected?.createdAt,
    )} will be permanently removed, including its audio. This cannot be undone.`}
    busy={deleting}
    onconfirm={deleteSelected}
    oncancel={() => (confirmingDelete = false)}
  />
</Pane>

<style>
  audio {
    width: 100%;
    margin-bottom: var(--space-medium);
  }

  .report-body {
    width: 100%;
    max-width: 800px;
    margin-inline: auto;
  }

  .timeline {
    margin-bottom: var(--space-large);
    padding-bottom: var(--space-small);
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .report-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-large);
    width: 100%;
    box-sizing: border-box;
    padding: var(--space-small) var(--space-medium);
    border: none;
    border-radius: var(--m3-shape-medium);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .entry:not(.selected) .report-row:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .report-title {
    width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--font-medium);
    font-weight: 500;
  }

  .badges {
    display: inline-flex;
    gap: var(--space-small);
    align-items: center;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-small);
    padding: 0 var(--space-small);
    border-radius: var(--m3-shape-full);
    font-size: var(--font-small);
    line-height: 1.4;
    white-space: nowrap;
  }

  .badge.topics {
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
  }

  .badge.sources {
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
  }

  .badge.audio.has-audio {
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .badge.audio:not(.has-audio) {
    border: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }
</style>
