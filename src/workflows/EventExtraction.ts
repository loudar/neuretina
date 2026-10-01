import type { LlmProvider } from "../capabilities/llm/LlmProvider.ts";
import type { CostTracker } from "../core/cost/CostTracker.ts";
import { isoDate } from "../core/dates.ts";
import { errorMessage } from "../core/errors.ts";
import { extractJson } from "../core/json.ts";
import type { Logger } from "../core/logger.ts";
import { textSimilarity } from "../core/text.ts";
import type { DecisionModelRegistry } from "../capabilities/decision/DecisionModel.ts";
import type { BriefSource } from "../domain/briefs/BriefRepository.ts";
import type { EventStore, TimelineEvent } from "../domain/events/EventRepository.ts";

/** Title similarity at which two events are treated as potential duplicates. */
const DUPLICATE_THRESHOLD = 0.6;
/** On the same day a looser title match is enough to review. */
const SAME_DAY_THRESHOLD = 0.45;
/** Confidence a selected tag must reach to be applied. */
const TAG_CONFIDENCE = 0.5;
/** Most events one brief may contribute. */
const MAX_EVENTS_PER_BRIEF = 8;

export interface EventSuggestion {
  date: string;
  time?: string;
  entities: string[];
  title: string;
  description: string;
}

export interface ExtractionResult {
  /** Events inserted or updated, in suggestion order. */
  events: TimelineEvent[];
  /** Tags invented during this extraction. */
  newTags: string[];
}

export interface EventExtractorDeps {
  llm: LlmProvider;
  events: EventStore;
  logger: Logger;
  /** Model used for the tag decision step; defaults to the provider's model. */
  tagModel?: string;
  /** Local decision models (Laya) for the tag choice; optional. */
  decisions?: DecisionModelRegistry;
  /** Minimum confidence before the decision model's pick is used. */
  decisionConfidence?: number;
  cost?: CostTracker;
  sessionId?: string;
  signal?: AbortSignal;
}

interface Candidate {
  event: TimelineEvent;
  score: number;
}

interface ReviewedEvent {
  id: string;
  date: string;
  time?: string;
  entities: string[];
  title: string;
  description: string;
}

/**
 * Turns a finished brief into dated events:
 * suggestions → potential duplicates (Levenshtein + % match, thresholded) →
 * LLM review of the candidates → upsert.
 *
 * Tags come from a decision step over the existing tag list plus "other".
 * "other" (or no confident match) asks the LLM for a new tag, which joins the
 * list for the following events — so the list stays small and reusable.
 */
export class EventExtractor {
  constructor(private readonly deps: EventExtractorDeps) {}

  async extract(input: {
    briefId?: string;
    brief: string;
    sources: BriefSource[];
  }): Promise<ExtractionResult> {
    const suggestions = await this.suggest(input);
    if (suggestions.length === 0) return { events: [], newTags: [] };

    const known = this.deps.events.list({ limit: 500 });
    const tagOptions = this.deps.events.tags();
    const events: TimelineEvent[] = [];
    const newTags: string[] = [];

    for (const suggestion of suggestions) {
      const candidates = findCandidates(suggestion, known);
      const reviewed = candidates.length > 0 ? await this.review(suggestion, candidates) : undefined;
      const tags = await this.categorize(suggestion, tagOptions, newTags);
      const target = reviewed ? known.find((event) => event.id === reviewed.id) : undefined;
      const event = this.deps.events.upsert({
        id: target?.id,
        date: reviewed?.date ?? suggestion.date,
        time: reviewed?.time ?? suggestion.time,
        entities: reviewed?.entities ?? suggestion.entities,
        tags: mergeTags(target?.tags, tags),
        title: reviewed?.title ?? suggestion.title,
        description: reviewed?.description ?? suggestion.description,
        sourceBriefId: input.briefId,
      });

      events.push(event);
      const index = known.findIndex((entry) => entry.id === event.id);
      if (index >= 0) known[index] = event;
      else known.unshift(event);
    }

    return { events, newTags };
  }

  /** One LLM call: dated events learned from the brief and its sources. */
  private async suggest(input: {
    brief: string;
    sources: BriefSource[];
  }): Promise<EventSuggestion[]> {
    const parsed = (await this.complete(SUGGEST_PROMPT, {
      today: isoDate(),
      brief: input.brief,
      sources: input.sources.map((source) => ({
        title: source.title,
        url: source.url,
        snippet: source.snippet,
      })),
    })) as { events?: unknown } | undefined;

    if (!Array.isArray(parsed?.events)) return [];
    const suggestions: EventSuggestion[] = [];
    for (const entry of parsed.events) {
      if (!entry || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      const date = typeof record.date === "string" ? record.date.trim() : "";
      const title = typeof record.title === "string" ? record.title.trim() : "";
      if (!isIsoDate(date) || !title) continue;
      suggestions.push({
        date,
        time: optionalTime(record.time),
        entities: stringList(record.entities),
        title,
        description: typeof record.description === "string" ? record.description.trim() : "",
      });
      if (suggestions.length >= MAX_EVENTS_PER_BRIEF) break;
    }
    return suggestions;
  }

  /** LLM review of the potential duplicates: same event (update) or new? */
  private async review(
    suggestion: EventSuggestion,
    candidates: Candidate[],
  ): Promise<ReviewedEvent | undefined> {
    const parsed = (await this.complete(REVIEW_PROMPT, {
      suggestion,
      candidates: candidates.map(({ event, score }) => ({
        id: event.id,
        date: event.date,
        time: event.time,
        title: event.title,
        description: event.description,
        entities: event.entities,
        similarity: Math.round(score * 100) / 100,
      })),
    })) as Record<string, unknown> | undefined;

    if (parsed?.action !== "update" || typeof parsed.id !== "string") return undefined;
    const candidate = candidates.find(({ event }) => event.id === parsed.id);
    if (!candidate) return undefined;

    const date = typeof parsed.date === "string" && isIsoDate(parsed.date.trim())
      ? parsed.date.trim()
      : suggestion.date;
    return {
      id: candidate.event.id,
      date,
      time: optionalTime(parsed.time) ?? suggestion.time,
      entities: Array.isArray(parsed.entities)
        ? stringList(parsed.entities)
        : suggestion.entities,
      title:
        typeof parsed.title === "string" && parsed.title.trim()
          ? parsed.title.trim()
          : suggestion.title,
      description:
        typeof parsed.description === "string" && parsed.description.trim()
          ? parsed.description.trim()
          : suggestion.description,
    };
  }

  /**
   * Tag decision: pick existing tags with confidence, or ask for a new one
   * when "other" wins (or nothing does). New tags extend the option list.
   * The local decision model (Laya) classifies first when it is available;
   * "other" or low confidence falls back to the LLM feedback loop.
   */
  private async categorize(
    suggestion: EventSuggestion,
    options: string[],
    newTags: string[],
  ): Promise<string[]> {
    const local = await this.categorizeWithDecisionModel(suggestion, options);
    if (local !== undefined) {
      if (local.length > 0) return local;
      const generated = await this.generateTag(suggestion, options);
      if (!generated) return [];
      options.push(generated);
      newTags.push(generated);
      return [generated];
    }

    const parsed = (await this.complete(
      CATEGORIZE_PROMPT,
      {
        event: {
          date: suggestion.date,
          title: suggestion.title,
          description: suggestion.description,
          entities: suggestion.entities,
        },
        options: [...options, "other"],
      },
      this.deps.tagModel,
    )) as { tags?: unknown } | undefined;

    const chosen: string[] = [];
    let wantsOther = false;
    if (Array.isArray(parsed?.tags)) {
      for (const entry of parsed.tags) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const tag = typeof record.tag === "string" ? record.tag.trim() : "";
        const confidence = typeof record.confidence === "number" ? record.confidence : 0;
        if (!tag || confidence < TAG_CONFIDENCE) continue;
        if (tag.toLowerCase() === "other") {
          wantsOther = true;
          continue;
        }
        const match = options.find((option) => option.toLowerCase() === tag.toLowerCase());
        if (match && !chosen.includes(match)) chosen.push(match);
      }
    }

    if (!wantsOther && chosen.length > 0) return chosen;

    const generated = await this.generateTag(suggestion, options);
    if (!generated) return chosen;
    options.push(generated);
    newTags.push(generated);
    return [...chosen, generated];
  }

  /**
   * Local decision model pass. Returns the chosen tags, `[]` when the model
   * says "other"/is unsure (the caller then asks the LLM for a new tag), or
   * undefined when no decision model is available (pure LLM path).
   */
  private async categorizeWithDecisionModel(
    suggestion: EventSuggestion,
    options: string[],
  ): Promise<string[] | undefined> {
    const model = this.deps.decisions?.get("laya");
    if (!model || options.length < 2) return undefined;
    try {
      if (!(await model.available())) return undefined;
      const answer = await model.choose(
        [
          suggestion.title,
          suggestion.description,
          suggestion.entities.length > 0 ? `Entities: ${suggestion.entities.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          instructions: "Pick the category tag that best fits the event.",
          options: {
            ...Object.fromEntries(options.map((tag) => [tag, `events about ${tag}`])),
            other: "none of the existing tags fits",
          },
        },
      );
      const threshold = this.deps.decisionConfidence ?? 0.55;
      if (answer.choice === "other" || answer.confidence < threshold) return [];
      const match = options.find(
        (option) => option.toLowerCase() === answer.choice.toLowerCase(),
      );
      return match ? [match] : [];
    } catch {
      return undefined;
    }
  }

  /** "Other" fallback: invent one reusable tag, checked against the options. */
  private async generateTag(
    suggestion: EventSuggestion,
    options: string[],
  ): Promise<string | undefined> {
    const parsed = (await this.complete(
      GENERATE_TAG_PROMPT,
      {
        event: { title: suggestion.title, description: suggestion.description },
        existing: options,
      },
      this.deps.tagModel,
    )) as { tag?: unknown } | undefined;

    const tag = normalizeTag(typeof parsed?.tag === "string" ? parsed.tag : "");
    if (!tag) return undefined;
    if (options.some((option) => option.toLowerCase() === tag.toLowerCase())) return undefined;
    return tag;
  }

  private async complete(
    system: string,
    user: unknown,
    model?: string,
  ): Promise<unknown> {
    const completion = await this.deps.llm.complete({
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) },
      ],
      responseFormat: "json",
      temperature: 0,
      ...(model ? { model } : {}),
      ...(this.deps.sessionId ? { sessionId: this.deps.sessionId } : {}),
      signal: this.deps.signal,
    });
    this.deps.cost?.addLlm("Events", completion.usage);
    this.deps.logger.debug("event extraction call", {
      characters: completion.text.length,
    });
    return extractJson(completion.text);
  }
}

/** Potential duplicates for a suggestion, best match first. */
export function findCandidates(
  suggestion: EventSuggestion,
  known: TimelineEvent[],
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const event of known) {
    const score = textSimilarity(suggestion.title, event.title);
    const sameDay = event.date === suggestion.date;
    if (score >= DUPLICATE_THRESHOLD || (sameDay && score >= SAME_DAY_THRESHOLD)) {
      candidates.push({ event, score });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 3);
}

export function mergeTags(existing: string[] | undefined, fresh: string[]): string[] {
  const merged = [...(existing ?? [])];
  for (const tag of fresh) {
    if (!merged.some((entry) => entry.toLowerCase() === tag.toLowerCase())) merged.push(tag);
  }
  return merged;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function optionalTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return /^\d{1,2}:\d{2}$/.test(trimmed) ? trimmed : undefined;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function normalizeTag(value: string): string | undefined {
  const tag = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  return tag.length >= 2 ? tag : undefined;
}

const SUGGEST_PROMPT = `You extract dated events from a briefing and its sources.

An event is anything learned from the material that is attributable to a specific calendar date: a release, a deal, a ruling, an earnings report, a statement, a market move. Skip facts that carry no date.

Rules:
- Resolve relative dates ("today", "yesterday") against the provided date; use the sources to confirm dates.
- One event per real-world happening, in one or two plain sentences with concrete facts (numbers, names, outcomes).
- entities are the people, companies, products, places or organizations the event is about, under their common names.
- Never invent material: if the date is unclear, leave the event out.
- At most 8 events; keep the most significant ones.

Finish with a single JSON object and nothing else:
{"events": [{"date": "YYYY-MM-DD", "time": "HH:MM", "title": "<short headline>", "description": "<1-2 sentences>", "entities": ["<entity>"]}]}
Omit "time" when the material does not state one.`;

const REVIEW_PROMPT = `You review a newly suggested event against existing stored events that may describe the same real-world happening.

Decide:
- "update": the suggestion is the same event as one of the candidates (it may add or correct detail). Return that candidate's id and the merged fields, preferring the most specific date/time and the most complete description.
- "add": the suggestion is a different event, even if it is related or similar.

Finish with a single JSON object and nothing else:
{"action": "update"|"add", "id": "<candidate id when updating>", "date": "YYYY-MM-DD", "time": "HH:MM", "title": "…", "description": "…", "entities": ["<entity>"]}`;

const CATEGORIZE_PROMPT = `You are a strict categorizer for timeline events. You receive one event and the list of existing category tags (plus "other").

Select every existing tag that clearly applies to the event, with a confidence between 0 and 1. Only tags reaching 0.5 are kept, so score obvious fits high and omit tags that are merely plausible. Prefer existing tags; never invent a tag yourself. If no existing tag fits, select "other".

Finish with a single JSON object and nothing else:
{"tags": [{"tag": "<existing tag or other>", "confidence": 0.0}]}`;

const GENERATE_TAG_PROMPT = `The existing category tags do not cover this event. Invent ONE short, reusable category tag that will group this event with others like it.

Rules:
- lowercase, one to three words joined by hyphens (e.g. "ai-regulation", "semiconductors")
- a durable category, never a one-off headline, company or person
- must not duplicate an existing tag

Finish with a single JSON object and nothing else:
{"tag": "<tag>"}`;
