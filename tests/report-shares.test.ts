import { describe, expect, test } from "bun:test";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { ReportRepository } from "../src/domain/reports/ReportRepository.ts";
import { ReportShareRepository } from "../src/domain/reports/ReportShareRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";

function setup(): ReportRepository {
  const db = new SqliteDatabase(":memory:");
  return new ReportRepository(new ArtifactRepository(db), new ReportShareRepository(db));
}

function createReport(reports: ReportRepository, topics: string[] = ["Rust"]) {
  return reports.create({
    topics,
    markdown: `# ${topics.join(", ")}`,
    narration: "spoken",
    sources: [],
  });
}

describe("report shares", () => {
  test("gives every report a stable token that resolves back to it", () => {
    const reports = setup();
    const report = createReport(reports);

    const token = reports.shareToken(report.id);
    expect(token).toBeTruthy();
    expect(reports.shareToken(report.id)).toBe(token!);
    expect(reports.findByShareToken(token!)?.id).toBe(report.id);
  });

  test("tokens are unique per report and unknown ones resolve to null", () => {
    const reports = setup();
    const first = createReport(reports, ["Rust"]);
    const second = createReport(reports, ["AI"]);

    expect(reports.shareToken(first.id)).not.toBe(reports.shareToken(second.id));
    expect(reports.findByShareToken("not-a-token")).toBeNull();
  });

  test("deleting a report revokes its token", () => {
    const reports = setup();
    const report = createReport(reports);
    const token = reports.shareToken(report.id)!;

    reports.remove(report.id);

    expect(reports.findByShareToken(token)).toBeNull();
  });

  test("a forgotten share resolves to null even while the report exists", () => {
    const reports = setup();
    const report = createReport(reports);
    const token = reports.shareToken(report.id)!;

    reports.forgetShare(report.id);

    expect(reports.findByShareToken(token)).toBeNull();
    expect(reports.shareToken(report.id)).not.toBe(token);
  });
});
