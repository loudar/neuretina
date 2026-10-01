/**
 * Minimal, safe Markdown → HTML renderer for the subset our compiler emits
 * (headings, bold/italic, inline code, links, lists, blockquotes). Input is
 * escaped first, so untrusted research content can never inject HTML.
 */
export function markdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (!listType) return;
    output.push(`</${listType}>`);
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim());
    if (heading?.[1] && heading[2] !== undefined) {
      closeList();
      // h1 → h2 so the title is not oversized in chat clients.
      const level = Math.min(heading[1].length + 1, 6);
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet?.[1] !== undefined) {
      if (listType !== "ul") {
        closeList();
        output.push("<ul>");
        listType = "ul";
      }
      output.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (numbered?.[1] !== undefined) {
      if (listType !== "ol") {
        closeList();
        output.push("<ol>");
        listType = "ol";
      }
      output.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote?.[1] !== undefined) {
      closeList();
      output.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }

    closeList();
    output.push(`<p>${inline(line.trim())}</p>`);
  }

  closeList();
  return output.join("\n");
}

function inline(text: string): string {
  let result = escapeHtml(text);

  result = result.replace(/`([^`]+)`/g, "<code>$1</code>");
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) =>
    isSafeUrl(url) ? `<a href="${escapeAttribute(url)}">${label}</a>` : label,
  );

  return result;
}

/** Escapes text for direct interpolation into HTML (no markdown parsing). */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return text.replace(/"/g, "&quot;");
}

function isSafeUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
