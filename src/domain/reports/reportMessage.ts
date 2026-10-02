import type { ReportSource } from "./ReportRepository.ts";

export interface ReportMessageOptions {
  /** Cap on highlighted source links (default 6). */
  maxSources?: number;
  /** Public app URL; with `reportId` and `shareToken` appends a "View this Report" link. */
  appUrl?: string;
  reportId?: string;
  /** Anonymous read-only token for the report; recipients have no account. */
  shareToken?: string;
}

/**
 * Message text for a report: the summary plus the most interesting sources as
 * clickable markdown links. This is only used for the text message �?" the
 * spoken narration never contains links or sources.
 */
export function buildReportMessage(
  markdown: string,
  sources: ReportSource[],
  options: ReportMessageOptions = {},
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
  const link = reportLink(options);
  if (link) lines.push("", link);
  if (lines.length === 0) return body;

  return `${body.trimEnd()}\n${lines.join("\n")}`;
}

function reportLink(options: ReportMessageOptions): string | undefined {
  if (!options.appUrl || !options.reportId || !options.shareToken) return undefined;
  const base = options.appUrl.replace(/\/+$/, "");
  const url = `${base}/reports/${encodeURIComponent(options.reportId)}?token=${encodeURIComponent(
    options.shareToken,
  )}`;
  return `[View this Report on Neuretina](${url})`;
}

/** Keeps [n] citation markers clickable in Matrix clients. */
function linkCitations(markdown: string, sources: ReportSource[]): string {
  return markdown.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const source = sources[Number(digits) - 1];
    if (!source) return match;
    return `[${digits}](${source.url})`;
  });
}

/** Keeps research order but avoids listing several links from the same site. */
export function selectHighlightSources(sources: ReportSource[], max: number): ReportSource[] {
  const seenHosts = new Set<string>();
  const picked: ReportSource[] = [];

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
