import { describe, expect, test } from "bun:test";
import { renderCitations } from "../web/src/lib/citations.ts";
import type { BriefSource } from "../web/src/lib/api.ts";

const sources: BriefSource[] = [
  { title: "First source", url: "https://a.com/1", provider: "perplexity" },
  { title: 'Second "quoted" <source>', url: "https://b.com/x?a=1&b=2", provider: "bluesky" },
];

describe("renderCitations", () => {
  test("turns markers into clickable numbered pills", () => {
    const html = renderCitations("<p>Up 12 percent [2].</p>", sources);

    expect(html).toContain('class="cite"');
    expect(html).toContain('href="https://b.com/x?a=1&amp;b=2"');
    expect(html).toContain('title="Second &quot;quoted&quot; &lt;source&gt;"');
    expect(html).toContain(">2</a>");
  });

  test("leaves unknown markers untouched", () => {
    expect(renderCitations("<p>See [9].</p>", sources)).toBe("<p>See [9].</p>");
    expect(renderCitations("<p>See [1].</p>", [])).toBe("<p>See [1].</p>");
  });
});
