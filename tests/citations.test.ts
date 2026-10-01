import { describe, expect, test } from "bun:test";
import { renderCitations } from "../web/src/lib/citations.ts";
import type { BriefSource } from "../web/src/lib/api.ts";

const sources: BriefSource[] = [
  { title: "First source", url: "https://a.com/1", provider: "perplexity" },
  { title: 'Second "quoted" <source>', url: "https://b.com/x?a=1&b=2", provider: "bluesky" },
];

const count = (value: string, search: string) => value.split(search).length - 1;

describe("renderCitations", () => {
  test("hides the marker and decorates the preceding text with a source popover", () => {
    const html = renderCitations("<p>Up 12 percent [2].</p>", sources);

    expect(html).toContain(
      '<span class="cite-anchor" tabindex="0">Up 12 percent<span class="cite-popover" role="tooltip">',
    );
    expect(html).toContain("</span></span>.</p>");
    expect(html).toContain('<span class="cite-ref">2</span>');
    expect(html).toContain('href="https://b.com/x?a=1&amp;b=2"');
    expect(html).toContain('Second "quoted" &lt;source&gt;');
    expect(html).toContain('<span class="cite-popover-domain">b.com</span>');
    expect(html).toContain('<span class="provider-tag" data-provider="bluesky">Bluesky</span>');
    expect(html).toContain('class="cite-favicon"');
    expect(html).not.toContain("[2]");
    expect(html).not.toContain('class="cite"');
  });

  test("groups adjacent markers into a single anchor", () => {
    const html = renderCitations("<p>A [1][2] B.</p>", sources);

    expect(count(html, 'class="cite-anchor"')).toBe(1);
    expect(count(html, 'class="cite-popover"')).toBe(1);
    expect(count(html, 'class="cite-popover-item"')).toBe(2);
    expect(html).toContain("</span></span> B.</p>");
  });

  test("wraps text that spans inline markup", () => {
    const html = renderCitations("<p>Text <strong>bold</strong> [1].</p>", sources);

    expect(html).toContain(
      '<span class="cite-anchor" tabindex="0">Text <strong>bold</strong><span class="cite-popover" role="tooltip">',
    );
  });

  test("drops the space before punctuation once the marker is stripped", () => {
    const html = renderCitations("<p>Up 12 percent [2].</p>", sources);

    expect(html).toContain("Up 12 percent<span");
    expect(html).toContain("</span></span>.</p>");
    expect(html).not.toContain(" .");
  });

  test("leaves text after the last citation unwrapped", () => {
    const html = renderCitations("<p>Claim [1] then tail.</p>", sources);

    expect(html.endsWith(" then tail.</p>")).toBe(true);
  });

  test("starts a new anchor for markers separated by text", () => {
    const html = renderCitations("<p>First [1] and second [2].</p>", sources);

    expect(count(html, 'class="cite-anchor"')).toBe(2);
    expect(count(html, 'class="cite-popover-item"')).toBe(2);
  });

  test("sorts and deduplicates resolved sources in a group", () => {
    const sorted = renderCitations("<p>Both [2][1] here.</p>", sources);
    expect(sorted.indexOf('<span class="cite-ref">1</span>')).toBeLessThan(
      sorted.indexOf('<span class="cite-ref">2</span>'),
    );

    const deduped = renderCitations("<p>Same [1][1] here.</p>", sources);
    expect(count(deduped, 'class="cite-popover-item"')).toBe(1);
  });

  test("drops unresolvable markers inside an otherwise resolvable group", () => {
    const html = renderCitations("<p>Mixed [1][9] here.</p>", sources);

    expect(count(html, 'class="cite-popover-item"')).toBe(1);
    expect(html).not.toContain("[9]");
    expect(html).not.toContain("[1]");
  });

  test("leaves unknown markers untouched", () => {
    expect(renderCitations("<p>See [9].</p>", sources)).toBe("<p>See [9].</p>");
    expect(renderCitations("<p>See [1].</p>", [])).toBe("<p>See [1].</p>");
  });

  test("ignores markers inside tag attributes", () => {
    const input = '<p>See <a href="https://example.com/[1]">link</a>.</p>';
    expect(renderCitations(input, sources)).toBe(input);
  });

  test("still processes text markers next to attribute markers", () => {
    const html = renderCitations('<p><a href="https://example.com/[2]">link</a> [1]</p>', sources);

    expect(html).toContain('href="https://example.com/[2]"');
    expect(html).toContain('<span class="cite-ref">1</span>');
    expect(html).not.toContain("[1]</");
  });

  test("processes every leaf block type", () => {
    for (const block of [
      "<li>Item [1]</li>",
      "<h3>Title [1]</h3>",
      "<blockquote>Quote [1]</blockquote>",
    ]) {
      const html = renderCitations(block, sources);
      expect(html).toContain('class="cite-anchor"');
      expect(html).not.toContain("[1]");
    }
  });

  test("does not touch markers outside leaf blocks", () => {
    const input = "<div>Box [1]</div>";
    expect(renderCitations(input, sources)).toBe(input);
  });
});
