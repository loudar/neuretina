import type { TimelineEvent } from "./api";

/** One marker on the timeline: a single event or a cluster of close events. */
export interface TimelineGroup {
  key: string;
  /** Position along the axis, 0 (earliest) … 1 (latest); 0.5 when all share a time. */
  position: number;
  /** Cluster members, earliest first. */
  events: TimelineEvent[];
}

export interface TimelineGroupingOptions {
  /** Rendered axis length in pixels; 0 while the track is not measured yet. */
  length?: number;
  /** Minimum distance between two markers in pixels. */
  minGap?: number;
}

/** Markers closer than this are rendered as one group. */
export const MIN_MARKER_GAP_PX = 96;
const FALLBACK_LENGTH_PX = 900;

/** Milliseconds for an event; events without a time sit at the start of the day. */
export function eventTime(event: TimelineEvent): number {
  const time = event.time && /^\d{1,2}:\d{2}$/.test(event.time) ? event.time : "00:00";
  const parsed = Date.parse(`${event.date}T${time}:00`);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** "12 Mar 2026" and "12 Mar 2026 · 09:30" for popovers. */
export function formatEventWhen(event: TimelineEvent): string {
  const date = new Date(`${event.date}T00:00:00`);
  const text = Number.isNaN(date.getTime())
    ? event.date
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  return event.time ? `${text} · ${event.time}` : text;
}

/**
 * Places events on a 0..1 axis (earliest → latest) and merges ones that would
 * sit closer than `minGap` pixels into a single marker. A marker sits at the
 * average of its cluster, so two markers stay at least `minGap` apart along the
 * supplied axis length.
 */
export function groupTimelineEvents(
  events: TimelineEvent[],
  options: TimelineGroupingOptions = {},
): TimelineGroup[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => eventTime(a) - eventTime(b) || a.id.localeCompare(b.id),
  );
  const times = sorted.map(eventTime);
  const first = times[0] ?? 0;
  const last = times[times.length - 1] ?? first;
  const span = last - first;

  const length = options.length && options.length > 0 ? options.length : FALLBACK_LENGTH_PX;
  const gap = (options.minGap ?? MIN_MARKER_GAP_PX) / length;

  const clusters: Array<{ position: number; count: number; events: TimelineEvent[] }> = [];
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    const position = span === 0 ? 0.5 : ((times[index] ?? first) - first) / span;
    const current = clusters[clusters.length - 1];
    if (current && position - current.position < gap) {
      current.count += 1;
      current.position += (position - current.position) / current.count;
      current.events.push(event);
    } else {
      clusters.push({ position, count: 1, events: [event] });
    }
  }

  return clusters.map((cluster) => ({
    key: cluster.events.map((event) => event.id).join(":"),
    position: cluster.position,
    events: cluster.events,
  }));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** A unit with more marks than this steps up to the next coarser one. */
export const MAX_SCALE_MARKS = 12;

export type TimelineScaleUnit = "date" | "week" | "month" | "year";

/** One tick label on the axis (a date, calendar week, month or year). */
export interface TimelineScaleMark {
  key: string;
  /** Position along the axis, 0 (first day) … 1 (last day). */
  position: number;
  label: string;
}

export interface TimelineScale {
  unit: TimelineScaleUnit;
  marks: TimelineScaleMark[];
}

interface RawMark {
  time: number;
  label: string;
}

interface TimelineDomain {
  start: number;
  end: number;
}

/**
 * Picks the axis scale from the spread of the events: direct dates while they
 * span at most 12 days, then ISO week numbers (1 … 53), months and finally
 * years. Whenever a unit would need more than {@link MAX_SCALE_MARKS} marks,
 * the next coarser unit is used.
 */
export function timelineScale(events: TimelineEvent[]): TimelineScale {
  if (events.length === 0) return { unit: "date", marks: [] };
  const domain = timelineDomain(events);
  const candidates: Array<{ unit: TimelineScaleUnit; marks: RawMark[] }> = [
    { unit: "date", marks: dateMarks(domain) },
    { unit: "week", marks: weekMarks(domain) },
    { unit: "month", marks: monthMarks(domain) },
    { unit: "year", marks: yearMarks(domain) },
  ];
  const chosen =
    candidates.find(
      (candidate) => candidate.marks.length > 0 && candidate.marks.length <= MAX_SCALE_MARKS,
    ) ??
    candidates.filter((candidate) => candidate.marks.length > 0).at(-1) ??
    candidates[0]!;

  return {
    unit: chosen.unit,
    marks: chosen.marks.map((mark) => ({
      key: `${chosen.unit}:${mark.time}`,
      position: domainPosition(mark.time, domain),
      label: mark.label,
    })),
  };
}

/** First and last day covered by the events (both at midnight). */
export function timelineDomain(events: TimelineEvent[]): TimelineDomain {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    const time = eventTime(event);
    if (time < min) min = time;
    if (time > max) max = time;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { start: 0, end: 0 };
  return { start: startOfDay(min), end: startOfDay(max) };
}

function domainPosition(time: number, domain: TimelineDomain): number {
  const span = domain.end - domain.start;
  if (span <= 0) return 0.5;
  return Math.min(1, Math.max(0, (time - domain.start) / span));
}

function dateMarks(domain: TimelineDomain): RawMark[] {
  const marks: RawMark[] = [];
  const cursor = new Date(domain.start);
  while (cursor.getTime() <= domain.end) {
    marks.push({ time: cursor.getTime(), label: formatDay(cursor.getTime()) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return marks;
}

function weekMarks(domain: TimelineDomain): RawMark[] {
  const marks: RawMark[] = [];
  const cursor = new Date(domain.start);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  while (cursor.getTime() <= domain.end) {
    if (cursor.getTime() >= domain.start) {
      marks.push({ time: cursor.getTime(), label: `W${isoWeek(cursor)}` });
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return marks;
}

function monthMarks(domain: TimelineDomain): RawMark[] {
  const marks: RawMark[] = [];
  const withYear = new Date(domain.start).getFullYear() !== new Date(domain.end).getFullYear();
  const cursor = new Date(domain.start);
  cursor.setDate(1);
  while (cursor.getTime() <= domain.end) {
    if (cursor.getTime() >= domain.start) {
      marks.push({ time: cursor.getTime(), label: formatMonth(cursor.getTime(), withYear) });
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return marks;
}

function yearMarks(domain: TimelineDomain): RawMark[] {
  const marks: RawMark[] = [];
  const cursor = new Date(domain.start);
  cursor.setMonth(0, 1);
  while (cursor.getTime() <= domain.end) {
    if (cursor.getTime() >= domain.start) {
      marks.push({ time: cursor.getTime(), label: String(cursor.getFullYear()) });
    }
    cursor.setFullYear(cursor.getFullYear() + 1);
  }
  return marks;
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatDay(time: number): string {
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function formatMonth(time: number, withYear: boolean): string {
  const date = new Date(time);
  const label = date.toLocaleDateString(undefined, { month: "short" });
  if (!withYear) return label;
  return `${label} '${String(date.getFullYear() % 100).padStart(2, "0")}`;
}

/** ISO-8601 week number (1 … 53) of a local date. */
function isoWeek(date: Date): number {
  const thursday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  thursday.setDate(thursday.getDate() - ((thursday.getDay() + 6) % 7) + 3);
  const firstThursday = new Date(thursday.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
  return 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}
