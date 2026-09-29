import { describe, expect, test } from "bun:test";
import {
  domainInitial,
  groupSourcesByDomain,
  providerLabel,
  sourceDomain,
} from "../web/src/lib/sources.ts";
import type { BriefSource } from "../web/src/lib/api.ts";

const sources: BriefSource[] = [
  { title: "A", url: "https://www.cbc.ca/news/a", provider: "perplexity" },
  { title: "B", url: "https://bsky.app/profile/x/post/1", provider: "bluesky" },
  { title: "C", url: "https://cbc.ca/news/c", provider: "perplexity" },
  { title: "D", url: "not a url", provider: "perplexity" },
];

describe("source grouping", () => {
  test("strips www and groups by domain in first-seen order", () => {
    const groups = groupSourcesByDomain(sources);
    expect(groups.map((group) => group.domain)).toEqual(["cbc.ca", "bsky.app", "other"]);
    expect(groups[0]?.sources.map((source) => source.title)).toEqual(["A", "C"]);
    expect(groups[0]?.providers).toEqual(["perplexity"]);
    expect(groups[1]?.providers).toEqual(["bluesky"]);
  });

  test("collects distinct providers per group", () => {
    const groups = groupSourcesByDomain([
      { title: "A", url: "https://example.com/a", provider: "perplexity" },
      { title: "B", url: "https://example.com/b", provider: "bluesky" },
      { title: "C", url: "https://example.com/c", provider: "perplexity" },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.providers).toEqual(["perplexity", "bluesky"]);
  });

  test("normalizes domains and falls back to other", () => {
    expect(sourceDomain("https://WWW.Example.COM/x")).toBe("example.com");
    expect(sourceDomain("mailto:x@example.com")).toBe("other");
  });

  test("provider labels are pretty", () => {
    expect(providerLabel("perplexity")).toBe("Perplexity");
    expect(providerLabel("bluesky")).toBe("Bluesky");
    expect(providerLabel("acme")).toBe("Acme");
  });

  test("domain initial", () => {
    expect(domainInitial("cbc.ca")).toBe("C");
    expect(domainInitial("123.net")).toBe("1");
    expect(domainInitial("")).toBe("?");
  });
});
