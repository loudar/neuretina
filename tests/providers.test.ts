import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { splitText, describeFormat, ElevenLabsTtsProvider } from "../src/providers/tts/ElevenLabsTtsProvider.ts";
import { buildVoiceContent } from "../src/providers/messaging/MatrixMessagingProvider.ts";
import { extractJson, stripMarkdown } from "../src/workflows/BriefingWorkflow.ts";

const fetchSpy = spyOn(globalThis, "fetch");

afterEach(() => {
  fetchSpy.mockReset();
});

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

describe("ElevenLabs text splitting", () => {
  test("keeps short text in one chunk", () => {
    expect(splitText("Hello world.", 100)).toEqual(["Hello world."]);
  });

  test("splits on sentence boundaries and respects the limit", () => {
    const text = "One sentence here. Two sentences here. Three sentences here.";
    const chunks = splitText(text, 25);
    expect(chunks.length).toBe(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(25);
    expect(chunks.join(" ")).toBe(text);
  });

  test("hard-splits very long sentences", () => {
    const text = "word ".repeat(50).trim();
    const chunks = splitText(text, 40);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40);
  });
});

describe("ElevenLabs output formats", () => {
  test("maps known formats", () => {
    expect(describeFormat("mp3_44100_128")).toEqual({
      mimeType: "audio/mpeg",
      extension: "mp3",
      bytesPerSecond: 16000,
    });
    expect(describeFormat("opus_48000_128")).toEqual({
      mimeType: "audio/ogg",
      extension: "ogg",
      bytesPerSecond: 16000,
    });
    expect(describeFormat("wav_44100").mimeType).toBe("audio/wav");
  });

  test("retries a transient 401 and succeeds", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ detail: { message: "Unauthorized" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });

    const provider = new ElevenLabsTtsProvider({
      apiKey: "key",
      baseUrl: "https://api.elevenlabs.io",
      modelId: "eleven_v4",
      voiceId: "voice",
      outputFormat: "opus_48000_128",
    });

    const audio = await provider.synthesize({ text: "hello" });

    expect(calls).toBe(2);
    expect(audio.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(audio.mimeType).toBe("audio/ogg");
  });
});

describe("Matrix voice message content", () => {
  test("builds an MSC3245 voice message", () => {
    const content = buildVoiceContent(
      {
        kind: "voice",
        audio: new Uint8Array([0, 1, 2]),
        mimeType: "audio/ogg",
        durationMs: 3000,
        filename: "brief.ogg",
        caption: "Morning brief",
      },
      "mxc://example.org/abc",
    );

    expect(content.msgtype).toBe("m.audio");
    expect(content.url).toBe("mxc://example.org/abc");
    expect(content.body).toBe("Morning brief");
    expect(content["org.matrix.msc3245.voice"]).toEqual({});
    expect(content["org.matrix.msc1767.audio"]).toEqual({ duration: 3000 });
    expect((content.info as Record<string, unknown>).duration).toBe(3000);
  });
});

describe("LLM output parsing", () => {
  test("extracts JSON from fenced and noisy output", () => {
    const fenced = '```json\n{"markdown": "# Hi", "narration": "Hi"}\n```';
    expect(extractJson<{ markdown: string }>(fenced)?.markdown).toBe("# Hi");

    const noisy = 'Sure! {"markdown": "a", "narration": "b"} Hope that helps.';
    expect(extractJson<{ narration: string }>(noisy)?.narration).toBe("b");

    expect(extractJson("no json here")).toBeUndefined();
  });

  test("strips markdown for fallback narration", () => {
    const markdown = "# Title\n\n- [Link](https://example.com) says **hello**\n1. item\n\n```code```";
    const stripped = stripMarkdown(markdown);
    expect(stripped).not.toContain("#");
    expect(stripped).not.toContain("https://example.com");
    expect(stripped).toContain("hello");
    expect(stripped).toContain("Link says");
  });
});
