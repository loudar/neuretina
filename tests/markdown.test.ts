import { describe, expect, test } from "bun:test";
import { markdownToHtml } from "../src/core/markdown.ts";

describe("markdownToHtml", () => {
  test("renders headings, lists, emphasis and paragraphs", () => {
    const html = markdownToHtml(
      "# Title\n\nText with **bold** and *italic* and `code`.\n\n## Section\n- one\n- two\n\n1. first\n2. second",
    );

    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<h3>Section</h3>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<ul>\n<li>one</li>\n<li>two</li>\n</ul>");
    expect(html).toContain("<ol>\n<li>first</li>\n<li>second</li>\n</ol>");
    expect(html).toContain("<p>");
  });

  test("escapes HTML and drops unsafe links", () => {
    const html = markdownToHtml(
      "<script>alert(1)</script> [click](javascript:alert(1)) [safe](https://example.com/x)",
    );

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="https://example.com/x"');
    expect(html).toContain(">safe</a>");
  });

  test("renders blockquotes", () => {
    expect(markdownToHtml("> quoted words")).toContain("<blockquote>quoted words</blockquote>");
  });
});
