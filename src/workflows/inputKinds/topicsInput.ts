import { ValidationError } from "../../core/errors.ts";
import type { WorkflowInputKind } from "../../core/workflow/inputs.ts";
import type { Topic } from "../../domain/topics/TopicRepository.ts";

/**
 * Topics as workflow context: the configured value pins the topic ids a run
 * covers. Resolution drops muted topics and expands to every active topic
 * when nothing is pinned.
 */
export function createTopicsInputKind(): WorkflowInputKind<string[], Topic[]> {
  return {
    id: "topics",
    title: "Topics",
    context: true,

    parse(value, spec, deps, { requireFilled }) {
      const ids = topicIds(value, spec.id);
      const known = new Set(deps.topics.list().map((topic) => topic.id));
      for (const id of ids) {
        if (!known.has(id)) throw new ValidationError(`Topic ${id} not found`);
      }
      const unique = [...new Set(ids)];
      if (requireFilled && spec.required && unique.length === 0) {
        throw new ValidationError(`"${spec.id}" must be a non-empty array of topic ids`);
      }
      return unique;
    },

    resolve(value, _spec, deps, { contextId }) {
      const active = deps.topics.listActive(contextId);
      // No configured value means every active topic; an empty list means none.
      if (!Array.isArray(value)) return active;
      const pinned = new Set(value.filter((id): id is string => typeof id === "string"));
      return active.filter((topic) => pinned.has(topic.id));
    },
  };
}

function topicIds(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new ValidationError(`"${field}" must be an array`);
  return value.map((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      throw new ValidationError(`"${field}[${index}]" must be a non-empty string`);
    }
    return entry.trim();
  });
}
