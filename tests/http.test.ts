import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { requestJson, requestRaw } from "../src/infra/http/request.ts";

const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

describe("http request helper", () => {
  test("retries retryable statuses with backoff", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls < 3) return new Response("busy", { status: 503 });
      return Response.json({ ok: true });
    });

    const result = await requestJson<{ ok: boolean }>(
      "test",
      "https://example.com/x",
      {},
      { retries: 2, baseDelayMs: 1 },
    );

    expect(result.ok).toBe(true);
    expect(calls).toBe(3);
  });

  test("retries network errors", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) throw new Error("socket closed");
      return Response.json({ ok: true });
    });

    const result = await requestJson("test", "https://example.com/x", {}, { retries: 1, baseDelayMs: 1 });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("does not retry when disabled, and surfaces the API error message", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          detail: { message: "The API key you used is missing the permission user_read" },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    });

    await expect(requestRaw("elevenlabs", "https://example.com/tts")).rejects.toThrow(
      /missing the permission user_read/,
    );
    expect(calls).toBe(1);
  });

  test("gives up after the configured retries", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      return new Response("still busy", { status: 503 });
    });

    await expect(
      requestJson("test", "https://example.com/x", {}, { retries: 2, baseDelayMs: 1 }),
    ).rejects.toThrow(/HTTP 503/);
    expect(calls).toBe(3);
  });
});
