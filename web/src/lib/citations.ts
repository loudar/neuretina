import type { BriefSource } from "./api";

/**
 * Turns [1]-style citation markers in rendered brief HTML into small
 * clickable numbered pills that link to the matching source.
 */
export function renderCitations(html: string, sources: BriefSource[]): string {
  return html.replace(/\[(\d+)\]/g, (match, digits: string) => {
    const source = sources[Number(digits) - 1];
    if (!source) return match;
    return (
      `<a class="cite" href="${escapeAttribute(source.url)}" target="_blank" rel="noreferrer"` +
      ` title="${escapeAttribute(source.title)}">${digits}</a>`
    );
  });
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
