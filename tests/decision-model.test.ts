import { afterEach, describe, expect, test } from "bun:test";
import type {
  ChoiceAnswer,
  DecisionModel,
} from "../src/capabilities/decision/DecisionModel.ts";
import { DecisionModelRegistry } from "../src/capabilities/decision/DecisionModel.ts";
import {
  decisionModelEndpoint,
  decisionModelLabel,
  parseDecisionModelConnections,
} from "../src/capabilities/decision/DecisionProviders.ts";
import { loadConfig } from "../src/config/env.ts";
import { SettingsService } from "../src/config/settings.ts";
import { createLogger } from "../src/core/logger.ts";
import type { KeyValueStore } from "../src/domain/kv/KeyValueRepository.ts";
import { EventRepository } from "../src/domain/events/EventRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { SystemOneDecisionModel } from "../src/providers/decision/SystemOneDecisionModel.ts";
import { EventExtractor } from "../src/workflows/EventExtraction.ts";
import { completion, stubLlm } from "./support.ts";

const log = createLogger("test", { level: "error" });
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

interface FetchCall {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
}

/** Replaces global fetch and records the JSON requests it receives. */
function stubFetch(respond: () => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as { url?: string }).url);
    calls.push({
      url,
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      headers: new Headers(init?.headers),
    });
    return respond();
  }) as typeof fetch;
  return calls;
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-1",
    provider: "jev" as const,
    model: "jev-latest",
    baseUrl: "https://api.typesafe.ai/v1/systemone",
    ...overrides,
  };
}

describe("SystemOneDecisionModel", () => {
  test("posts the schema and returns the calibrated choice", async () => {
    const calls = stubFetch(() =>
      Response.json({
        model: "jev-1.13.0",
        answers: {
          choice: {
            type: "choice",
            choice: "billing",
            confidence: 0.81,
            probabilities: { billing: 0.9, technical: 0.1 },
          },
        },
      }),
    );
    const model = new SystemOneDecisionModel({
      id: "conn-1",
      provider: "TypeSafe",
      model: "jev-latest",
      endpoint: "https://api.typesafe.ai/v1/systemone",
      apiKey: "secret",
    });

    expect(await model.available()).toBe(true);
    expect(model.label).toBe("TypeSafe - jev-latest");

    const answer = await model.choose("state text", {
      instructions: "Pick the team",
      options: { billing: "payments", technical: "bugs" },
    });

    expect(answer).toEqual({
      choice: "billing",
      confidence: 0.81,
      probabilities: { billing: 0.9, technical: 0.1 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer secret");
    expect(calls[0]?.body).toEqual({
      model: "jev-latest",
      state: "state text",
      questions: {
        choice: {
          type: "choice",
          instructions: "Pick the team",
          criteria: { billing: "payments", technical: "bugs" },
        },
      },
    });
  });

  test("unwraps the Workers AI envelope and derives a missing confidence", async () => {
    stubFetch(() =>
      Response.json({
        result: {
          model: "clef",
          answers: {
            choice: { type: "choice", choice: "a", probabilities: { a: 0.9, b: 0.1 } },
          },
        },
        success: true,
      }),
    );
    const model = new SystemOneDecisionModel({
      id: "conn-2",
      provider: "Cloudflare",
      model: "clef",
      endpoint: "https://api.cloudflare.com/client/v4/accounts/acct/ai/run/@cf/cloudflare/clef",
    });

    const answer = await model.choose("state", {
      instructions: "Pick",
      options: { a: "first", b: "second" },
    });
    expect(answer.choice).toBe("a");
    // (0.9 - 1/2) / (1 - 1/2) = 0.8, TypeSafe's confidence definition.
    expect(answer.confidence).toBeCloseTo(0.8, 5);
  });

  test("verify() sends one noul question and reports the answer", async () => {
    stubFetch(() =>
      Response.json({ answers: { verify: { type: "noul", noul: 0.95 } } }),
    );
    const model = new SystemOneDecisionModel({
      id: "conn-1",
      provider: "TypeSafe",
      model: "jev-latest",
      endpoint: "https://api.typesafe.ai/v1/systemone",
    });

    expect(await model.verify()).toBe("replied (test probability 0.95)");
  });

  test("surfaces the endpoint's error status", async () => {
    stubFetch(() => new Response("invalid key", { status: 401, statusText: "Unauthorized" }));
    const model = new SystemOneDecisionModel({
      id: "conn-1",
      provider: "TypeSafe",
      model: "jev-latest",
      endpoint: "https://api.typesafe.ai/v1/systemone",
    });

    await expect(
      model.choose("state", { instructions: "Pick", options: { a: "x", b: "y" } }),
    ).rejects.toThrow(/401 Unauthorized/);
  });
});

describe("decision provider presets", () => {
  test("builds provider-specific endpoints, rejecting incomplete ones", () => {
    expect(
      decisionModelEndpoint(connection({ baseUrl: "https://api.typesafe.ai/v1/systemone/" })),
    ).toBe("https://api.typesafe.ai/v1/systemone");

    expect(
      decisionModelEndpoint({
        id: "conn-2",
        provider: "clef",
        model: "clef-flash",
        baseUrl: "https://api.cloudflare.com/client/v4",
        accountId: "abc",
      }),
    ).toBe(
      "https://api.cloudflare.com/client/v4/accounts/abc/ai/run/@cf/cloudflare/clef-flash",
    );

    // Account-scoped providers need the account id.
    expect(
      decisionModelEndpoint({
        id: "conn-3",
        provider: "clef",
        model: "clef",
        baseUrl: "https://api.cloudflare.com/client/v4",
      }),
    ).toBeUndefined();

    expect(decisionModelLabel(connection())).toBe("TypeSafe - jev-latest");
    expect(
      decisionModelLabel({
        id: "conn-4",
        provider: "clef",
        model: "clef",
        baseUrl: "https://api.cloudflare.com/client/v4",
        accountId: "abc",
      }),
    ).toBe("Cloudflare - clef");
  });

  test("rejects malformed connection lists", () => {
    expect(parseDecisionModelConnections([connection()])).toHaveLength(1);
    expect(
      parseDecisionModelConnections([{ id: "x", provider: "nope", model: "m", baseUrl: "u" }]),
    ).toBeUndefined();
    expect(parseDecisionModelConnections({})).toBeUndefined();
  });
});

class MapKv implements KeyValueStore {
  private readonly map = new Map<string, string>();

  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.map.set(key, value);
  }

  delete(key: string): void {
    this.map.delete(key);
  }
}

describe("decision model settings", () => {
  test("stores connections as JSON and applies the active selection", () => {
    const config = loadConfig({});
    const service = new SettingsService({ kv: new MapKv(), env: {}, config });
    service.applyAll();

    const entry = connection({ apiKey: "key" });
    const info = service.set("DECISION_MODELS", JSON.stringify([entry]));
    expect(info.kind).toBe("json");
    expect(info.stored).toBe(true);
    expect(config.decisionModels).toEqual([entry]);

    service.set("DECISION_MODEL", "conn-1");
    expect(config.decisionModel).toBe("conn-1");

    expect(() => service.set("DECISION_MODELS", "not json")).toThrow(/valid JSON/);
    expect(() =>
      service.set("DECISION_MODELS", JSON.stringify([{ id: "x", provider: "nope" }])),
    ).toThrow();
    expect(config.decisionModels).toEqual([entry]);
  });
});

describe("EventExtractor decision model selection", () => {
  /** Stub model that answers with one choice and counts its calls. */
  function stubDecision(
    name: string,
    choice: string,
    onCall: () => void,
  ): DecisionModel {
    return {
      name,
      available: async () => true,
      choose: async (): Promise<ChoiceAnswer> => {
        onCall();
        return { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
      },
    };
  }

  function extractorWith(options: {
    decisions: DecisionModelRegistry;
    decisionModel?: string;
  }): { extractor: EventExtractor; events: EventRepository } {
    const events = new EventRepository(new SqliteDatabase(":memory:"));
    events.upsert({ date: "2026-09-01", tags: ["markets"], title: "Old market event" });
    events.upsert({ date: "2026-09-02", tags: ["ai"], title: "Old AI event" });

    const llm = stubLlm((request) => {
      const system = request.messages[0]?.content ?? "";
      if (system.includes("extract dated events")) {
        return completion(
          JSON.stringify({
            events: [
              {
                date: "2026-09-30",
                title: "Nvidia earnings",
                description: "Revenue beat consensus.",
                entities: ["Nvidia"],
              },
            ],
          }),
        );
      }
      return completion("{}");
    });

    return {
      events,
      extractor: new EventExtractor({
        llm,
        events,
        logger: log,
        decisions: options.decisions,
        ...(options.decisionModel ? { decisionModel: options.decisionModel } : {}),
        decisionConfidence: 0.5,
      }),
    };
  }

  test("the selected hosted connection wins over the local model", async () => {
    const registry = new DecisionModelRegistry();
    let hosted = 0;
    let local = 0;
    registry.register(stubDecision("conn-1", "markets", () => hosted++));
    registry.register(stubDecision("laya", "ai", () => local++));

    const { extractor } = extractorWith({ decisions: registry, decisionModel: "conn-1" });
    const result = await extractor.extract({ brief: "# Brief", sources: [] });

    expect(result.events[0]?.tags).toEqual(["markets"]);
    expect(hosted).toBe(1);
    expect(local).toBe(0);
  });

  test("falls back to the local model when nothing is selected", async () => {
    const registry = new DecisionModelRegistry();
    let local = 0;
    registry.register(stubDecision("conn-1", "markets", () => undefined));
    registry.register(stubDecision("laya", "ai", () => local++));

    const { extractor } = extractorWith({ decisions: registry });
    const result = await extractor.extract({ brief: "# Brief", sources: [] });

    expect(result.events[0]?.tags).toEqual(["ai"]);
    expect(local).toBe(1);
  });

  test("an unknown selection falls back to the local model", async () => {
    const registry = new DecisionModelRegistry();
    let local = 0;
    registry.register(stubDecision("laya", "markets", () => local++));

    const { extractor } = extractorWith({ decisions: registry, decisionModel: "removed" });
    const result = await extractor.extract({ brief: "# Brief", sources: [] });

    expect(result.events[0]?.tags).toEqual(["markets"]);
    expect(local).toBe(1);
  });
});
