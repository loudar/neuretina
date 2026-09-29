import { describe, expect, test } from "bun:test";
import { createKernel } from "../src/kernel/Kernel.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { ArtifactRepository } from "../src/domain/artifacts/ArtifactRepository.ts";
import { BriefRepository } from "../src/domain/briefs/BriefRepository.ts";
import { ContextRepository } from "../src/domain/contexts/ContextRepository.ts";
import { JobRepository } from "../src/domain/jobs/JobRepository.ts";
import { KeyValueRepository } from "../src/domain/kv/KeyValueRepository.ts";
import { WorkflowRunRepository } from "../src/domain/runs/WorkflowRunRepository.ts";
import { TopicRepository } from "../src/domain/topics/TopicRepository.ts";
import { testConfig } from "./support.ts";

describe("kernel storage overrides", () => {
  test("runs on swapped stores without opening SQLite", async () => {
    const memory = new SqliteDatabase(":memory:");
    const artifacts = new ArtifactRepository(memory);
    const stores = {
      events: new EventStore(memory),
      artifacts,
      topics: new TopicRepository(memory),
      briefs: new BriefRepository(artifacts),
      jobs: new JobRepository(memory),
      kv: new KeyValueRepository(memory),
      contexts: new ContextRepository(memory),
      runs: new WorkflowRunRepository(memory),
    };

    const kernel = await createKernel({ config: testConfig(), stores });

    try {
      expect(kernel.db).toBeNull();

      // Everything writes through the injected stores, not the defaults.
      const topic = kernel.topics.add({ name: "Rust" });
      expect(stores.topics.list().map((entry) => entry.id)).toEqual([topic.id]);

      const brief = kernel.briefs.create({
        topics: ["Rust"],
        markdown: "# Rust",
        narration: "n",
        sources: [],
      });
      expect(stores.briefs.get(brief.id).markdown).toBe("# Rust");

      expect(stores.jobs.count()).toBe(1); // the seeded morning-brief job
    } finally {
      await kernel.shutdown();
    }
  });
});
