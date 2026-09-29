import { describe, expect, test } from "bun:test";
import { MAX_FOLLOWUP_TASKS, parseFollowupTasks } from "../src/workflows/FollowupResearch.ts";

describe("parseFollowupTasks", () => {
  test("parses questions and reasons", () => {
    const tasks = parseFollowupTasks(
      '{"tasks":[{"question":"What does this mean for suppliers?","reason":"context"}]}',
    );

    expect(tasks).toEqual([
      { question: "What does this mean for suppliers?", reason: "context" },
    ]);
  });

  test("caps the task count and ignores malformed entries", () => {
    const tasks = parseFollowupTasks(
      JSON.stringify({
        tasks: [
          1,
          {},
          { question: "a" },
          { question: "b" },
          { question: "c" },
          { question: "d" },
        ],
      }),
    );

    expect(tasks.map((task) => task.question)).toEqual(["a", "b", "c"]);
    expect(tasks).toHaveLength(MAX_FOLLOWUP_TASKS);
  });

  test("returns nothing for missing or malformed JSON", () => {
    expect(parseFollowupTasks("no json here")).toEqual([]);
    expect(parseFollowupTasks('{"tasks": "nope"}')).toEqual([]);
    expect(parseFollowupTasks('{"tasks": [{"question": "   "}]}')).toEqual([]);
  });
});
