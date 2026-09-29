import { describe, expect, test } from "bun:test";
import { buildBriefMessage, selectHighlightSources } from "../src/domain/briefs/briefMessage.ts";
import type { BriefSource } from "../src/domain/briefs/BriefRepository.ts";

const sources: BriefSource[] = [
  { title: "First", url: "https://a.com/1", provider: "perplexity" },
  { title: "Same domain", url: "https://a.com/2", provider: "perplexity" },
  { title: "Second [brackets]", url: "https://b.com/x", provider: "bluesky" },
  { title: "Third", url: "https://c.com", provider: "perplexity" },
];

describe("selectHighlightSources", () => {
  test("keeps research order but avoids duplicate domains and caps the list", () => {
    const picked = selectHighlightSources(sources, 2);
    expect(picked.map((source) => source.url)).toEqual(["https://a.com/1", "https://b.com/x"]);
  });
});

describe("buildBriefMessage", () => {
  test("appends clickable markdown sources and sanitizes titles", () => {
    const message = buildBriefMessage("# Brief\n\nBody.", sources, 3);

    expect(message).toContain("**Sources**");
    expect(message).toContain("1. [First](https://a.com/1)");
    expect(message).toContain("[Second (brackets)](https://b.com/x)");
    expect(message).not.toContain("https://a.com/2");
  });

  test("returns the summary unchanged when there are no sources", () => {
    expect(buildBriefMessage("# Brief", [])).toBe("# Brief");
  });

  test("keeps citation markers clickable in the message body", () => {
    const message = buildBriefMessage("Up 12 percent [2].", sources);

    expect(message).toContain("Up 12 percent [2](https://a.com/2).");
  });
});
