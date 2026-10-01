import type { BriefSource } from "./BriefRepository.ts";

export interface BriefMessageOptions {
  /** Cap on highlighted source links (default 6). */
  maxSources?: number;
  /** Public app URL; with `briefId` appends a "View this Brief" link. */
  appUrl?: string;
  briefId?: string;
}

/**
 * Message text for a brief: the summary plus the most interesting sources as
 * clickable markdown links. This is only used for the text message �?" the
 * spoken narration never contains links or sources.
 */
export function buildBriefMessage(
  markdown: string,
  sources: BriefSource[],
  options: BriefMessageOptions = {},
): string {
  const body = linkCitations(markdown, sources);
  const highlights = selectHighlightSources(sources, options.maxSources ?? 6);
  const lines: string[] = [];
  if (highlights.length > 0) {
    lines.push(
      "",
      "**Sources**",
      ...highlights.map(
        (source, index) => `${index + 1}. [${sanitizeTitle(source.title)}](${source.url})`,
      ),
    );
  }
  const link = briefLink(options);
  if (link) lines.push("", link);
  if (lines.length === 0) return body;

  return `${body.trimEnd()}\n${lines.join("\n")}`;
}

function briefLink(options: BriefMessageOptions): string | undefined {
  if (!options.appUrl || !options.briefId) return undefined;
  const base = options.appUrl.replace(/\/+$/, "");
  return `[View this Brief on Neuretina](${base}/briefs/${options.briefId})`;
}

/** Keeps [n] citation markers clickable in Matrix clients. */
function linkCitations(markdown: string, sources: BriefSource[]): string {
  return markdown.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const source = sources[Number(digits) - 1];
    if (!source) return match;
    return `[${digits}](${source.url})`;
  });
}

/** Keeps research order but avoids listing several links from the same site. */
export function selectHighlightSources(sources: BriefSource[], max: number): BriefSource[] {
  const seenHosts = new Set<string>();
  const picked: BriefSource[] = [];

  for (const source of sources) {
    const host = hostOf(source.url);
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    picked.push(source);
    if (picked.length >= max) break;
  }

  return picked;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function sanitizeTitle(title: string): string {
  return title.replace(/\[/g, "(").replace(/\]/g, ")");
}
