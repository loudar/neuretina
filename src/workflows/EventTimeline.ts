import type { TimelineEvent } from "../domain/events/EventRepository.ts";

/** Tag matches count as related only within this many days. */
const RELATED_WINDOW_DAYS = 30;
const MAX_TIMELINE_EVENTS = 60;

/**
 * The timeline for freshly extracted events: the events themselves plus the
 * stored events they are related to — sharing an entity, or sharing a tag
 * within a month. Newest first.
 */
export function selectTimelineEvents(
  fresh: TimelineEvent[],
  all: TimelineEvent[],
): TimelineEvent[] {
  const selected = new Map<string, TimelineEvent>();
  for (const event of fresh) selected.set(event.id, event);

  for (const event of all) {
    if (selected.has(event.id)) continue;
    if (fresh.some((anchor) => related(anchor, event))) selected.set(event.id, event);
  }

  return [...selected.values()]
    .sort((a, b) =>
      a.date === b.date
        ? (a.time ?? "").localeCompare(b.time ?? "")
        : b.date.localeCompare(a.date),
    )
    .slice(0, MAX_TIMELINE_EVENTS);
}

/** Markdown rendering of a timeline artifact. */
export function renderTimelineMarkdown(events: TimelineEvent[]): string {
  const lines: string[] = ["## Timeline", ""];
  let currentDate = "";
  for (const event of events) {
    if (event.date !== currentDate) {
      currentDate = event.date;
      lines.push(`### ${event.date}`, "");
    }
    lines.push(event.time ? `**${event.title}** · ${event.time}` : `**${event.title}**`);
    if (event.description) lines.push(event.description);
    const meta = [
      ...event.tags.map((tag) => `#${tag}`),
      ...event.entities,
    ].join(" · ");
    if (meta) lines.push(`*${meta}*`);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

function related(a: TimelineEvent, b: TimelineEvent): boolean {
  const entities = new Set(a.entities.map((entity) => entity.toLowerCase()));
  if (b.entities.some((entity) => entities.has(entity.toLowerCase()))) return true;

  const tags = new Set(a.tags.map((tag) => tag.toLowerCase()));
  if (!b.tags.some((tag) => tags.has(tag.toLowerCase()))) return false;
  return withinDays(a.date, b.date, RELATED_WINDOW_DAYS);
}

function withinDays(a: string, b: string, days: number): boolean {
  const left = Date.parse(`${a}T00:00:00Z`);
  const right = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return false;
  return Math.abs(left - right) <= days * 24 * 60 * 60 * 1000;
}
