import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { OpenAiCompatibleLlmProvider } from "../src/providers/llm/OpenAiCompatibleLlmProvider.ts";

const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

const completionBody = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 0,
  model: "deepseek-v4-flash",
  choices: [
    { index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" },
  ],
  usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
};

interface CapturedCall {
  url: string;
  headers: Headers;
}

function captureCalls(): CapturedCall[] {
  const calls: CapturedCall[] = [];
  mockFetch(async (input, init) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers) });
    return Response.json(completionBody);
  });
  return calls;
}

function provider(sessionId?: string): OpenAiCompatibleLlmProvider {
  return new OpenAiCompatibleLlmProvider({
    apiKey: "test-key",
    baseUrl: "https://opencode.ai/zen/go/v1",
    defaultModel: "deepseek-v4-flash",
    sessionId,
  });
}

const userMessage = [{ role: "user" as const, content: "hi" }];

describe("OpenAiCompatibleLlmProvider", () => {
  test("sends the per-request session id and a client user agent", async () => {
    const calls = captureCalls();
    const result = await provider().complete({ messages: userMessage, sessionId: "run-123" });

    expect(result.text).toBe("OK");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/chat/completions");
    expect(calls[0]!.headers.get("x-opencode-session")).toBe("run-123");
    expect(calls[0]!.headers.get("user-agent")).toContain("neuretina/");
  });

  test("falls back to a stable configured session id", async () => {
    const seen: Array<string | null> = [];
    mockFetch(async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-opencode-session"));
      return Response.json(completionBody);
    });

    const client = provider("pinned-session");
    await client.complete({ messages: userMessage });
    await client.complete({ messages: userMessage });

    expect(seen).toEqual(["pinned-session", "pinned-session"]);
  });

  test("generates a stable per-process session id when nothing is configured", async () => {
    const seen: Array<string | null> = [];
    mockFetch(async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-opencode-session"));
      return Response.json(completionBody);
    });

    const client = provider();
    await client.complete({ messages: userMessage });
    await client.complete({ messages: userMessage });

    expect(seen[0]).toBeTruthy();
    expect(seen[0]).toBe(seen[1]);
  });

  test("serves keyless local endpoints without an Authorization header", async () => {
    const calls = captureCalls();
    const client = new OpenAiCompatibleLlmProvider({
      baseUrl: "http://localhost:11434/v1",
      defaultModel: "llama3.3",
      apiKeyRequired: false,
    });

    await expect(client.verify()).resolves.toBe("reachable");
    await expect(client.complete({ messages: userMessage })).resolves.toMatchObject({
      text: "OK",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });

  test("refuses to verify keyed endpoints without a key", async () => {
    const client = new OpenAiCompatibleLlmProvider({
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5",
    });

    await expect(client.verify()).rejects.toThrow("not configured");
  });
});
