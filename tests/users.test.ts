import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/core/logger.ts";
import { createKernel } from "../src/kernel/Kernel.ts";
import { StubTts, completion, stubLlm, stubSearch, testConfig } from "./support.ts";

describe("per-user runtimes", () => {
  test("each account only sees its own data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "neuretina-users-"));
    const kernel = await createKernel({
      config: testConfig({ DB_PATH: join(dir, "app.db") }),
      logger: createLogger("test", { level: "error" }),
      llm: stubLlm(() => completion("ok")),
      webSearch: stubSearch("perplexity", "web"),
      socialSearch: stubSearch("bluesky", "social"),
      tts: new StubTts(),
    });

    try {
      expect(kernel.adminUser).toBe("admin");

      await kernel.commands.execute("topic.create", { name: "admin topic" }, "test");
      const bob = kernel.runtimeFor("bob");
      await bob.commands.execute("topic.create", { name: "bob topic" }, "test");

      expect(kernel.topics.list().map((topic) => topic.name)).toEqual(["admin topic"]);
      expect(bob.topics.list().map((topic) => topic.name)).toEqual(["bob topic"]);
      expect(kernel.users.get("bob")?.id).toBe("bob");

      // Audit logs and live feeds are per account as well.
      const created = (events: { topic: string }[]) =>
        events.filter((event) => event.topic === "topic.created");
      expect(created(kernel.bus.replayAfter(0, 500))).toHaveLength(1);
      expect(created(bob.bus.replayAfter(0, 100))).toHaveLength(1);

      // A second access returns the same runtime (no duplicate databases).
      expect(kernel.runtimeFor("bob")).toBe(bob);
    } finally {
      await kernel.shutdown();
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Windows may keep SQLite WAL handles briefly; the temp dir is disposable.
      }
    }
  });
});
