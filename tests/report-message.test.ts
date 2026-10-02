import { describe, expect, test } from "bun:test";
import { buildReportMessage, selectHighlightSources } from "../src/domain/reports/reportMessage.ts";
import type { ReportSource } from "../src/domain/reports/ReportRepository.ts";

const sources: ReportSource[] = [
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

describe("buildReportMessage", () => {
  test("appends clickable markdown sources and sanitizes titles", () => {
    const message = buildReportMessage("# Report\n\nBody.", sources, { maxSources: 3 });

    expect(message).toContain("**Sources**");
    expect(message).toContain("1. [First](https://a.com/1)");
    expect(message).toContain("[Second (brackets)](https://b.com/x)");
    expect(message).not.toContain("https://a.com/2");
  });

  test("returns the summary unchanged when there are no sources", () => {
    expect(buildReportMessage("# Report", [])).toBe("# Report");
  });

  test("keeps citation markers clickable in the message body", () => {
    const message = buildReportMessage("Up 12 percent [2].", sources);

    expect(message).toContain("Up 12 percent [2](https://a.com/2).");
  });

  test("appends the share link with the anonymous token", () => {
    const message = buildReportMessage("# Report", [], {
      appUrl: "https://reports.test/",
      reportId: "report-1",
      shareToken: "abc123",
    });

    expect(message).toContain(
      "[View this Report on Neuretina](https://reports.test/reports/report-1?token=abc123)",
    );
  });

  test("omits the link when no share token exists", () => {
    const message = buildReportMessage("# Report", [], {
      appUrl: "https://reports.test",
      reportId: "report-1",
    });

    expect(message).not.toContain("View this Report");
  });
});
