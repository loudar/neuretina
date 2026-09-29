import { describe, expect, test } from "bun:test";
import { CodeModeTool } from "../src/agents/tools/CodeModeTool.ts";
import type { Tool, ToolContext } from "../src/agents/Tool.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { createLogger } from "../src/core/logger.ts";

const log = createLogger("test", { level: "error" });

function toolContext(): ToolContext {
  const db = new SqliteDatabase(":memory:");
  const bus = new EventBus(new EventStore(db), log);
  return { correlationId: "c-code", bus, logger: log, agent: "researcher" };
}

function stubTool(overrides: Partial<Tool> = {}): Tool {
  return {
    name: "lookup",
    description: "Test lookup",
    parameters: {},
    execute: async (args) => ({
      query: args.query,
      provider: "stub",
      results: [
        {
          title: "Result",
          url: "https://example.com/a",
          snippet: "Snippet",
          source: "example.com",
          media: [
            {
              type: "image",
              thumbUrl: "https://example.com/thumb.jpg",
              fullUrl: "https://example.com/full.jpg",
              alt: "a chart",
            },
          ],
        },
      ],
    }),
    ...overrides,
  };
}

describe("CodeModeTool", () => {
  test("runs a program that calls tools in parallel and aggregates sources", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    const result = await tool.execute(
      {
        code: `async () => {
          const [a, b] = await Promise.all([lookup({ query: "one" }), lookup({ query: "two" })]);
          return { n: a.results.length + b.results.length };
        }`,
      },
      toolContext(),
    );

    expect(result.result).toEqual({ n: 2 });
    expect(result.toolCalls).toBe(2);
    expect(result.queries).toEqual(["one", "two"]);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.provider).toBe("stub");
    expect(result.results[0]?.url).toBe("https://example.com/a");
    expect(result.results[0]?.snippet).toBe("Snippet");
    expect(result.results[0]?.media?.[0]?.thumbUrl).toBe("https://example.com/thumb.jpg");
  });

  test("accepts a plain async function body as well as an arrow function", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    const result = await tool.execute(
      { code: `const r = await lookup({ query: "body" }); return r.results.length;` },
      toolContext(),
    );

    expect(result.result).toBe(1);
  });

  test("captures console output", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    const result = await tool.execute(
      { code: `async () => { console.log("hello", 42); return "ok"; }` },
      toolContext(),
    );

    expect(result.result).toBe("ok");
    expect(result.logs).toEqual(["hello 42"]);
  });

  test("reports program errors back so the model can fix its code", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    await expect(
      tool.execute({ code: `async () => { throw new Error("boom"); }` }, toolContext()),
    ).rejects.toThrow("boom");
  });

  test("a failed tool call resolves to an error value instead of aborting the program", async () => {
    const failing = stubTool({
      name: "bad",
      execute: async () => {
        throw new Error("provider down");
      },
    });
    const tool = new CodeModeTool({ tools: [failing, stubTool()] });

    const result = await tool.execute(
      {
        code: `async () => {
          const [failed, good] = await Promise.all([
            bad({ query: "x" }),
            lookup({ query: "y" }),
          ]);
          return {
            error: failed.error,
            badResults: failed.results.length,
            goodResults: good.results.length,
          };
        }`,
      },
      toolContext(),
    );

    expect(result.result).toEqual({ error: "provider down", badResults: 0, goodResults: 1 });
    expect(result.toolCalls).toBe(2);
  });

  test("reports program errors with captured logs", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    await expect(
      tool.execute(
        {
          code: `async () => { console.log("debug info"); throw new Error("boom"); }`,
        },
        toolContext(),
      ),
    ).rejects.toThrow(/boom[\s\S]*debug info/);
  });

  test("rejects code that tries to leave the sandbox", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });

    await expect(
      tool.execute(
        { code: `async () => { await fetch("https://example.com"); }` },
        toolContext(),
      ),
    ).rejects.toThrow("fetch");
  });

  test("enforces the tool-call budget inside the sandbox", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()], maxToolCalls: 2 });

    const result = await tool.execute(
      {
        code: `async () => {
          let ok = 0;
          let err = 0;
          for (let i = 0; i < 4; i++) {
            const result = await lookup({ query: "q" + i });
            if (result.error) err++;
            else ok++;
          }
          return { ok, err };
        }`,
      },
      toolContext(),
    );

    expect(result.result).toEqual({ ok: 2, err: 2 });
    expect(result.toolCalls).toBe(2);
  });

  test("kills a runaway program at the timeout", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()], timeoutMs: 500 });

    await expect(
      tool.execute({ code: `async () => { while (true) {} }` }, toolContext()),
    ).rejects.toThrow(/timed out/);
  });

  test("does not count tool execution time against the idle timeout", async () => {
    const slow = stubTool({
      execute: async () => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        return { provider: "stub", results: [] };
      },
    });
    const tool = new CodeModeTool({
      tools: [slow],
      idleTimeoutMs: 300,
      timeoutMs: 5000,
    });

    const result = await tool.execute(
      { code: `async () => { await lookup({ query: "slow" }); return "done"; }` },
      toolContext(),
    );

    expect(result.result).toBe("done");
  });

  test("stalls a program that stops making progress", async () => {
    const tool = new CodeModeTool({
      tools: [stubTool()],
      idleTimeoutMs: 300,
      timeoutMs: 5000,
    });

    await expect(
      tool.execute(
        { code: `async () => { await new Promise((resolve) => setTimeout(resolve, 5000)); }` },
        toolContext(),
      ),
    ).rejects.toThrow(/stalled/);
  });

  test("caps a program that keeps making tool calls forever", async () => {
    const tool = new CodeModeTool({
      tools: [stubTool()],
      timeoutMs: 800,
      idleTimeoutMs: 5000,
    });

    await expect(
      tool.execute(
        {
          code: `async () => {
            while (true) {
              try { await lookup({ query: "x" }); } catch {}
            }
          }`,
        },
        toolContext(),
      ),
    ).rejects.toThrow(/timed out after 800ms/);
  });

  test("requires code", async () => {
    const tool = new CodeModeTool({ tools: [stubTool()] });
    await expect(tool.execute({}, toolContext())).rejects.toThrow("`code` is required");
  });
});
