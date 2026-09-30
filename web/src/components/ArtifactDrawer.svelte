<script lang="ts">
  import { Button, Icon } from "m3-svelte";
  import iconClose from "@ktibow/iconset-material-symbols/close";
  import type { ArtifactInfo } from "../lib/api";
  import ArtifactView from "./ArtifactView.svelte";

  interface Props {
    artifact: ArtifactInfo;
    onclose: () => void;
  }

  let { artifact, onclose }: Props = $props();

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onclose();
  }
</script>

<svelte:window {onkeydown} />

<aside class="drawer">
  <header class="drawer-head">
    <div class="titles">
      <h2>{artifact.name ?? artifact.id.slice(0, 8)}</h2>
      <small class="muted">
        {artifact.kind} · {artifact.contentType}{artifact.byteSize
          ? ` · ${Math.max(1, Math.round(artifact.byteSize / 1024))} KB`
          : ""}
      </small>
    </div>
    <Button variant="text" iconType="full" title="Close" onclick={onclose}>
      <Icon icon={iconClose} />
    </Button>
  </header>

  <div class="drawer-body">
    <ArtifactView {artifact} onremove={onclose} />
  </div>
</aside>

<style>
  .drawer {
    position: fixed;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    width: min(34rem, 92vw);
    background-color: var(--m3c-surface-container-low);
    border-inline-start: 1px solid var(--m3c-outline-variant);
    box-shadow: var(--m3-elevation-3);
  }

  .drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    height: 3.5rem;
    flex: none;
    padding: 0 1rem;
    border-bottom: 1px solid var(--m3c-outline-variant);
  }

  .titles {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
  }

  .titles h2 {
    font-size: 1rem;
    font-weight: 600;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .titles small {
    font-size: 0.72rem;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .drawer-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 1rem;
  }
</style>
