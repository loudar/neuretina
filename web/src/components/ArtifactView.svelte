<script lang="ts">
  import { Button, Dialog, Icon } from "m3-svelte";
  import iconDelete from "@ktibow/iconset-material-symbols/delete";
  import iconHistory from "@ktibow/iconset-material-symbols/history";
  import { commands, type ArtifactInfo, type BriefSource } from "../lib/api";
  import { renderCitations } from "../lib/citations";
  import { reportError, reportSuccess } from "../lib/feedback";
  import { paths, router } from "../lib/router.svelte";
  import { markdownToHtml } from "../../../src/core/markdown.ts";

  interface Props {
    artifact: ArtifactInfo;
    /** Called after the artifact was deleted (close the drawer / clear the pane). */
    onremove?: () => void;
  }

  let { artifact, onremove }: Props = $props();

  let text = $state<string | null>(null);
  let dataUrl = $state<string | null>(null);
  let loading = $state(true);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  const isMarkdown = $derived(
    artifact.kind === "brief" || artifact.contentType === "text/markdown",
  );
  const isAudio = $derived(artifact.contentType.startsWith("audio/"));
  const isImage = $derived(artifact.contentType.startsWith("image/"));
  const sources = $derived(
    Array.isArray(artifact.metadata.sources) ? (artifact.metadata.sources as BriefSource[]) : [],
  );
  const html = $derived(
    isMarkdown && text !== null ? renderCitations(markdownToHtml(text), sources) : "",
  );
  const runPath = $derived(
    artifact.workflow && artifact.correlationId
      ? paths.workflows(artifact.workflow, artifact.correlationId)
      : null,
  );

  $effect(() => {
    const id = artifact.id;
    const hasData = artifact.hasData;
    const hasContent = artifact.hasContent;
    text = null;
    dataUrl = null;
    loading = true;

    void (async () => {
      try {
        if (hasData) {
          const data = await commands.artifacts.data(id);
          dataUrl = data?.dataUrl ?? null;
        } else if (hasContent) {
          const content = await commands.artifacts.content(id);
          text = content.content ?? "";
        }
      } catch (error) {
        reportError(error);
      } finally {
        loading = false;
      }
    })();
  });

  async function remove(): Promise<void> {
    if (deleting) return;
    deleting = true;
    try {
      await commands.artifacts.remove(artifact.id);
      confirmingDelete = false;
      reportSuccess("Artifact deleted");
      onremove?.();
    } catch (error) {
      reportError(error);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="artifact-actions">
  {#if runPath}
    <Button variant="tonal" iconType="left" onclick={() => router.navigate(runPath)}>
      <Icon icon={iconHistory} /> Open run
    </Button>
  {/if}
  <Button
    variant="text"
    iconType="left"
    onclick={() => (confirmingDelete = true)}
    disabled={deleting}
  >
    <Icon icon={iconDelete} /> Delete
  </Button>
</div>

{#if loading}
  <p class="muted">Loading…</p>
{:else if isAudio && dataUrl}
  <audio controls src={dataUrl}></audio>
{:else if isImage && dataUrl}
  <img src={dataUrl} alt={artifact.name ?? artifact.kind} />
{:else if isMarkdown && text !== null}
  <div class="markdown">{@html html}</div>
{:else if text !== null}
  <pre>{text}</pre>
{:else if dataUrl}
  <p class="muted">
    Binary artifact ({artifact.contentType},{Math.max(1, Math.round((artifact.byteSize ?? 0) / 1024))} KB).
  </p>
{:else}
  <p class="muted">No content stored for this artifact.</p>
{/if}

{#if !isMarkdown}
  <h3 class="subhead">Metadata</h3>
  <pre>{JSON.stringify(artifact.metadata, null, 2)}</pre>
{/if}

<Dialog headline="Delete this artifact?" bind:open={confirmingDelete}>
  <p>
    "{artifact.name ?? artifact.id.slice(0, 8)}" ({artifact.kind}) will be permanently removed,
    including anything referencing it (e.g. a brief's audio). This cannot be undone.
  </p>
  {#snippet buttons()}
    <Button variant="text" onclick={() => (confirmingDelete = false)} disabled={deleting}>
      Cancel
    </Button>
    <Button variant="filled" onclick={remove} disabled={deleting}>Delete</Button>
  {/snippet}
</Dialog>

<style>
  .artifact-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  audio {
    width: 100%;
  }

  img {
    max-width: 100%;
    border-radius: var(--m3-shape-small);
  }

  .subhead {
    margin: 1.25rem 0 0.5rem;
  }

  pre {
    margin: 0;
    padding: 0.75rem;
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-lowest);
    font-size: 0.8rem;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .markdown {
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .markdown :global(> :first-child) {
    margin-top: 0;
  }

  .markdown :global(h2),
  .markdown :global(h3),
  .markdown :global(h4) {
    margin: 0.9rem 0 0.4rem;
    font-size: 1.05rem;
    font-weight: 600;
  }

  .markdown :global(p) {
    margin: 0 0 0.7rem;
  }

  .markdown :global(ul),
  .markdown :global(ol) {
    margin: 0 0 0.7rem;
    padding-inline-start: 1.25rem;
  }

  .markdown :global(li) {
    margin-bottom: 0.2rem;
  }

  .markdown :global(blockquote) {
    margin: 0 0 0.7rem;
    padding-inline-start: 0.75rem;
    border-inline-start: 3px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
  }

  .markdown :global(a) {
    color: var(--m3c-primary);
  }

  .markdown :global(a.cite) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.25em;
    height: 1.25em;
    padding: 0 0.35em;
    margin: 0 0.1em;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1;
    text-decoration: none;
    vertical-align: 0.2em;
  }

  .markdown :global(a.cite:hover) {
    background-color: var(--m3c-primary-container);
    color: var(--m3c-on-primary-container);
  }

  .markdown :global(code) {
    padding: 0.05rem 0.3rem;
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-high);
    font-size: 0.85em;
  }
</style>
