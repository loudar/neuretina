import type { BriefSource } from "./api";
import { faviconUrl, providerLabel, sourceDomain } from "./sources";

/**
 * Removes [n] citation markers from rendered brief HTML and wraps the text
 * preceding each citation group in a hover popover linking to the sources.
 */
export function renderCitations(html: string, sources: BriefSource[]): string {
  return html.replace(
    /<(p|li|h[1-6]|blockquote)([^>]*)>([\s\S]*?)<\/\1>/g,
    (_match, tag: string, attrs: string, inner: string) =>
      `<${tag}${attrs}>${decorateBlock(inner, sources)}</${tag}>`,
  );
}

interface CitationMarker {
  start: number;
  end: number;
  number: number;
}

function decorateBlock(inner: string, sources: BriefSource[]): string {
  const markers = findMarkers(inner);
  if (markers.length === 0) return inner;

  const groups: CitationMarker[][] = [];
  for (const marker of markers) {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && marker.start === previous.end) {
      current.push(marker);
    } else {
      groups.push([marker]);
    }
  }

  let output = "";
  let cursor = 0;

  for (const group of groups) {
    const start = group[0]?.start ?? cursor;
    const end = group[group.length - 1]?.end ?? cursor;
    const indices = resolveIndices(group, sources.length);

    if (indices.length === 0) {
      output += inner.slice(cursor, end);
      cursor = end;
      continue;
    }

    const segment = inner.slice(cursor, start);
    const text = segment.replace(/\s+$/, "");
    const gap = segment.slice(text.length);
    const after = inner.slice(end);
    const following = after.replace(/^[ \t]+/, "");
    const leadingGap = after.slice(0, after.length - following.length);
    let separator = "";
    if (following === "" || /^[.,;:!?%)\]}…"'”’»]/.test(following)) {
      // No text follows, or it is punctuation: the space before the marker
      // must go too, otherwise it renders as "word ." once the marker is gone.
      cursor = end + leadingGap.length;
    } else {
      // Text follows: a single space must survive the marker, either from
      // before it or from the one already sitting after it.
      if (leadingGap.length === 0) separator = gap;
      cursor = end;
    }
    output += /\S/.test(text)
      ? wrapSegment(text, indices, sources) + separator
      : segment;
  }

  return output + inner.slice(cursor);
}

function findMarkers(inner: string): CitationMarker[] {
  const markers: CitationMarker[] = [];
  const pattern = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(inner))) {
    const start = match.index;
    if (inner.lastIndexOf("<", start) > inner.lastIndexOf(">", start)) continue;
    markers.push({ start, end: start + match[0].length, number: Number(match[1]) });
  }

  return markers;
}

function resolveIndices(group: CitationMarker[], sourceCount: number): number[] {
  const indices = new Set<number>();
  for (const marker of group) {
    if (marker.number >= 1 && marker.number <= sourceCount) indices.add(marker.number);
  }
  return [...indices].sort((a, b) => a - b);
}

function wrapSegment(segment: string, indices: number[], sources: BriefSource[]): string {
  let items = "";
  for (const index of indices) {
    const source = sources[index - 1];
    if (!source) continue;
    items +=
      `<a class="cite-popover-item" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer">` +
      `<span class="cite-ref">${index}</span>` +
      `<img class="cite-favicon" src="${escapeAttribute(faviconUrl(sourceDomain(source.url)))}" alt="" onerror="this.remove()" />` +
      `<span class="cite-popover-body">` +
      `<span class="cite-popover-title">${escapeText(source.title)}</span>` +
      `<span class="cite-popover-meta">` +
      `<span class="cite-popover-domain">${escapeText(sourceDomain(source.url))}</span>` +
      `<span class="provider-tag" data-provider="${escapeAttribute(source.provider)}">${escapeText(providerLabel(source.provider))}</span>` +
      `</span>` +
      `</span>` +
      `</a>`;
  }

  return (
    `<span class="cite-anchor" tabindex="0">${segment}` +
    `<span class="cite-popover" role="tooltip">${items}</span></span>`
  );
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
