<script lang="ts">
  import { Icon, TextFieldOutlined } from "m3-svelte";
  import iconClose from "@ktibow/iconset-material-symbols/close";
  import iconExpandMore from "@ktibow/iconset-material-symbols/expand-more";
  import iconOpenInNew from "@ktibow/iconset-material-symbols/open-in-new";
  import iconPlay from "@ktibow/iconset-material-symbols/play-arrow";
  import iconSearch from "@ktibow/iconset-material-symbols/search";
  import type { BriefSource } from "../lib/api";
  import {
    domainInitial,
    filterSources,
    groupSourcesByDomain,
    providerLabel,
  } from "../lib/sources";

  interface Props {
    sources: BriefSource[];
    filter?: string;
    onfilter?: (value: string) => void;
  }

  let { sources, filter, onfilter }: Props = $props();

  let internalFilter = $state("");
  const value = $derived(filter ?? internalFilter);
  const filtered = $derived(filterSources(sources, value));
  const groups = $derived(groupSourcesByDomain(filtered));
  const filtering = $derived(value.trim().length > 0);
  const numbers = $derived(new Map(sources.map((source, index) => [source, index + 1])));

  $effect(() => {
    void sources;
    internalFilter = "";
  });

  function setFilter(next: string): void {
    if (onfilter) onfilter(next);
    else internalFilter = next;
  }
</script>

{#if sources.length > 0}
  <div class="source-section">
    <div class="source-section-head">
      <h3>Sources</h3>
      <span class="total">
        {filtering ? `${filtered.length} of ${sources.length}` : sources.length}
      </span>
    </div>
    <TextFieldOutlined
      label="Filter sources"
      leadingIcon={iconSearch}
      value={value}
      oninput={(event) => setFilter(event.currentTarget.value)}
      trailing={filtering ? { icon: iconClose, onclick: () => setFilter("") } : undefined}
    />
    {#if groups.length === 0}
      <p class="muted">No sources match "{value.trim()}".</p>
    {:else}
      <div class="source-groups">
        {#each groups as group (group.domain)}
          <details class="source-group" open={filtering}>
            <summary>
              <span class="monogram" aria-hidden="true">{domainInitial(group.domain)}</span>
              <span class="domain">{group.domain}</span>
              <span class="count">{group.sources.length}</span>
              <span class="provider-tags">
                {#each group.providers as provider (provider)}
                  <span class="provider-tag" data-provider={provider}>
                    {providerLabel(provider)}
                  </span>
                {/each}
              </span>
              <span class="chevron"><Icon icon={iconExpandMore} size={18} /></span>
            </summary>
            <ul>
              {#each group.sources as source (source.url)}
                <li class="source">
                  <a class="source-head" href={source.url} target="_blank" rel="noreferrer">
                    <span class="ref">{numbers.get(source)}</span>
                    <span class="title">{source.title}</span>
                    <span class="open" aria-hidden="true">
                      <Icon icon={iconOpenInNew} size={15} />
                    </span>
                  </a>
                  {#if source.provider === "bluesky" && source.snippet}
                    <p class="snippet">{source.snippet}</p>
                  {/if}
                  {#if source.media?.length}
                    <div class="media">
                      {#each source.media as item, index (item.thumbUrl + index)}
                        <a
                          class="media-item"
                          href={item.type === "video" ? source.url : item.fullUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={item.alt ?? "Open media"}
                        >
                          <img
                            src={item.thumbUrl}
                            alt={item.alt ?? ""}
                            loading="lazy"
                            width={item.width}
                            height={item.height}
                            style={item.width && item.height
                              ? `aspect-ratio: ${item.width} / ${item.height};`
                              : ""}
                          />
                          {#if item.type === "video"}
                            <span class="play" aria-hidden="true">
                              <Icon icon={iconPlay} size={18} />
                            </span>
                          {/if}
                        </a>
                      {/each}
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </details>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .source-section {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1rem;
  }

  .source-section-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .total {
    padding: 0.05rem 0.5rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-surface-container-highest);
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
    line-height: 1.5;
  }

  .source-groups {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .source-group {
    border: 1px solid var(--m3c-outline-variant);
    border-radius: var(--m3-shape-medium);
    background-color: var(--m3c-surface-container-low);
    overflow: hidden;
  }

  .source-group summary {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    list-style: none;
    user-select: none;
  }

  .source-group summary::-webkit-details-marker {
    display: none;
  }

  .source-group summary:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .monogram {
    display: grid;
    place-items: center;
    width: 1.6rem;
    height: 1.6rem;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-secondary-container);
    color: var(--m3c-on-secondary-container);
    font-size: 0.8rem;
    font-weight: 600;
  }

  .domain {
    font-weight: 600;
    font-size: 0.9rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    color: var(--m3c-on-surface-variant);
    font-size: 0.75rem;
  }

  .provider-tags {
    display: inline-flex;
    gap: 0.3rem;
    margin-left: auto;
  }

  .provider-tag {
    padding: 0.05rem 0.45rem;
    border-radius: var(--m3-shape-full);
    border: 1px solid var(--m3c-outline-variant);
    color: var(--m3c-on-surface-variant);
    font-size: 0.68rem;
    line-height: 1.5;
    white-space: nowrap;
  }

  .provider-tag[data-provider="perplexity"] {
    border-color: transparent;
    background-color: var(--m3c-primary-container);
    color: var(--m3c-on-primary-container);
  }

  .provider-tag[data-provider="bluesky"] {
    border-color: transparent;
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
  }

  .chevron {
    display: inline-flex;
    color: var(--m3c-on-surface-variant);
    transition: transform 150ms;
  }

  .source-group[open] .chevron {
    transform: rotate(180deg);
  }

  .source-group ul {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin: 0;
    padding: 0 0.4rem 0.4rem;
    list-style: none;
  }

  .source {
    padding: 0.5rem 0.6rem;
    border-radius: var(--m3-shape-small);
    background-color: var(--m3c-surface-container-highest);
  }

  .source:hover {
    background-color: var(--m3c-surface-container-high);
  }

  .source-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    color: var(--m3c-on-surface);
    text-decoration: none;
  }

  .ref {
    display: inline-grid;
    place-items: center;
    flex: none;
    min-width: 1.35em;
    height: 1.35em;
    padding: 0 0.25em;
    border-radius: var(--m3-shape-full);
    background-color: var(--m3c-tertiary-container);
    color: var(--m3c-on-tertiary-container);
    font-size: 0.68rem;
    font-weight: 600;
    line-height: 1;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: 0.88rem;
    line-height: 1.35;
  }

  .open {
    display: inline-flex;
    color: var(--m3c-on-surface-variant);
    opacity: 0;
    transition: opacity 120ms;
  }

  .source-head:hover .open,
  .source-head:focus-visible .open {
    opacity: 1;
  }

  .snippet {
    margin: 0.2rem 0 0;
    font-size: 0.84rem;
    line-height: 1.45;
    color: var(--m3c-on-surface-variant);
    white-space: pre-wrap;
  }

  .media {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
    margin-top: 0.45rem;
  }

  .media-item {
    position: relative;
    display: inline-flex;
    border-radius: var(--m3-shape-small);
    overflow: hidden;
  }

  .media img {
    display: block;
    height: 7rem;
    width: auto;
    max-width: 100%;
    object-fit: cover;
    background-color: var(--m3c-surface-container-highest);
  }

  .media-item:hover img {
    opacity: 0.9;
  }

  .play {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #fff;
    background-color: rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
</style>
