import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { splitText, describeFormat, ElevenLabsTtsProvider } from "../src/providers/tts/ElevenLabsTtsProvider.ts";
import { buildVoiceContent } from "../src/providers/messaging/MatrixMessagingProvider.ts";
import { PerplexitySearchProvider, dateDaysAgo } from "../src/providers/search/PerplexitySearchProvider.ts";
import { QwenTtsProvider } from "../src/providers/tts/QwenTtsProvider.ts";
import { convertToOggOpus } from "../src/providers/tts/convertToOggOpus.ts";
import { AGENT_STEP_LIMIT_MESSAGE } from "../src/agents/Agent.ts";
import { extractJson, stripMarkdown, sanitizeNarration, parseResearchOutcome } from "../src/workflows/BriefingWorkflow.ts";

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

  test("sends the configured speed and omits it at the default", async () => {
    const bodies: string[] = [];
    mockFetch(async (_input, init) => {
      bodies.push(String(init?.body));
      return new Response(new Uint8Array([1]), { status: 200 });
    });

    const fast = new ElevenLabsTtsProvider({
      apiKey: "key",
      baseUrl: "https://api.elevenlabs.io",
      modelId: "eleven_turbo_v2_5",
      voiceId: "voice",
      outputFormat: "opus_48000_128",
      speed: 1.2,
    });
    await fast.synthesize({ text: "hello" });
    expect((JSON.parse(bodies[0]!) as { voice_settings?: unknown }).voice_settings).toEqual({
      speed: 1.2,
    });

    const normal = new ElevenLabsTtsProvider({
      apiKey: "key",
      baseUrl: "https://api.elevenlabs.io",
      modelId: "eleven_v4",
      voiceId: "voice",
      outputFormat: "opus_48000_128",
      speed: 1,
    });
    await normal.synthesize({ text: "hello" });
    expect((JSON.parse(bodies[1]!) as { voice_settings?: unknown }).voice_settings).toBeUndefined();
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

  test("narration sanitizer removes URLs, citation markers and source lists", () => {
    const sanitized = sanitizeNarration(
      "Rust is quiet today. Details at https://example.com/deep [1] and www.example.org/x.\nSources: 1. CBC — https://cbc.ca/1\n2. Guardian",
    );

    expect(sanitized).not.toContain("http");
    expect(sanitized).not.toContain("www.");
    expect(sanitized).not.toContain("[1]");
    expect(sanitized).not.toContain("Sources");
    expect(sanitized).toContain("Rust is quiet today.");
  });

  test("narration sanitizer leaves clean narration untouched", () => {
    const text = "Rust is quiet today. AI regulation is debated. Worth looking up: the new rules.";
    expect(sanitizeNarration(text)).toBe(text);
  });

  test("narration sanitizer turns symbols into speakable forms", () => {
    expect(sanitizeNarration("Up 30% & rising")).toBe("Up 30 percent and rising");
  });

  test("parses the research verdict including missing topics", () => {
    const outcome = parseResearchOutcome(
      JSON.stringify({
        found: true,
        notes: "notes here",
        missingTopics: [" quantum computing ", 42, ""],
      }),
    );

    expect(outcome.found).toBe(true);
    expect(outcome.notes).toBe("notes here");
    expect(outcome.missingTopics).toEqual(["quantum computing"]);
  });

  test("research verdict falls back to prose as found", () => {
    const outcome = parseResearchOutcome("Just some notes without JSON.");
    expect(outcome.found).toBe(true);
    expect(outcome.notes).toContain("Just some notes");
    expect(outcome.missingTopics).toEqual([]);
  });

  test("treats a step-limited agent answer as nothing found", () => {
    const outcome = parseResearchOutcome(AGENT_STEP_LIMIT_MESSAGE);
    expect(outcome.found).toBe(false);
    expect(outcome.notes).toContain("ran out of steps");
  });
});

describe("Perplexity domain filter", () => {
  test("sends the allowlist and caps it at 20 domains", async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ results: [], id: "search-1" });
    });

    const provider = new PerplexitySearchProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });

    await provider.search({
      query: "climate policy",
      domains: Array.from({ length: 25 }, (_, index) => `d${index}.com`),
    });

    expect((body.search_domain_filter as string[]).length).toBe(20);
  });

  test("omits the filter when no domains are given", async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ results: [], id: "search-2" });
    });

    const provider = new PerplexitySearchProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });

    await provider.search({ query: "anything" });

    expect(body.search_domain_filter).toBeUndefined();
  });
});

describe("Perplexity recency and language filters", () => {
  test("maps 3days to a publication date filter and sends the language", async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ results: [], id: "search-3" });
    });

    const provider = new PerplexitySearchProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });

    await provider.search({ query: "x", recency: "3days", language: "en" });

    expect(body.search_recency_filter).toBeUndefined();
    expect(String(body.search_after_date_filter)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(body.search_language_filter).toEqual(["en"]);
  });

  test("passes coarse recency windows through", async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ results: [], id: "search-4" });
    });

    const provider = new PerplexitySearchProvider({
      apiKey: "key",
      baseUrl: "https://api.perplexity.ai",
    });

    await provider.search({ query: "x", recency: "week" });

    expect(body.search_recency_filter).toBe("week");
    expect(body.search_after_date_filter).toBeUndefined();
  });

  test("dateDaysAgo formats MM/DD/YYYY", () => {
    expect(dateDaysAgo(3, new Date(2026, 8, 29, 12).getTime())).toBe("09/26/2026");
  });
});

describe("Qwen TTS provider", () => {
  test("posts to the local OpenAI speech endpoint and maps opus to Ogg", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    mockFetch(async (input, init) => {
      url = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });

    const provider = new QwenTtsProvider({
      baseUrl: "http://127.0.0.1:8880/v1",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
    });

    const audio = await provider.synthesize({ text: "hello" });

    expect(url).toBe("http://127.0.0.1:8880/v1/audio/speech");
    expect(body).toMatchObject({
      model: "tts-1",
      voice: "Ryan",
      input: "hello",
      response_format: "opus",
    });
    expect(audio.mimeType).toBe("audio/ogg");
    expect(audio.extension).toBe("ogg");
    expect(audio.data).toEqual(new Uint8Array([1, 2, 3]));
  });

  test("rejects an empty audio response", async () => {
    mockFetch(async () => new Response(new Uint8Array(0), { status: 200 }));

    const provider = new QwenTtsProvider({
      baseUrl: "http://tts.test/v1",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "wav",
    });

    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/empty audio/);
  });

  test("trusts the response content type when the server ignores the format", async () => {
    mockFetch(
      async () =>
        new Response(new Uint8Array([1, 2]), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
    );

    const provider = new QwenTtsProvider({
      baseUrl: "http://tts.test/v1",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
    });

    const audio = await provider.synthesize({ text: "x" });

    expect(audio.mimeType).toBe("audio/wav");
    expect(audio.extension).toBe("wav");
  });

  test("fails clearly when no local server is configured", async () => {
    const provider = new QwenTtsProvider({
      baseUrl: "",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
    });

    await expect(provider.synthesize({ text: "x" })).rejects.toThrow(/QWEN_TTS_BASE_URL/);
  });

  test("asks strict servers for wav while delivering the configured format", async () => {
    let body: Record<string, unknown> = {};
    mockFetch(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(silentWav(), {
        status: 200,
        headers: { "Content-Type": "audio/wav" },
      });
    });

    const provider = new QwenTtsProvider({
      baseUrl: "http://tts.test/v1",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
      requestFormat: "wav",
    });

    const audio = await provider.synthesize({ text: "x" });

    expect(body.response_format).toBe("wav");
    // ffmpeg converts the WAV to Ogg/Opus; without it the WAV is kept as a fallback.
    expect(audio.mimeType).toBe(hasFfmpeg ? "audio/ogg" : "audio/wav");
  });
});

function silentWav(samples = 4800): Uint8Array {
  const dataSize = samples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index++) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  write(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 24000, true);
  view.setUint32(28, 48000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, dataSize, true);
  return new Uint8Array(buffer);
}

const hasFfmpeg = Boolean(process.env.FFMPEG_PATH) || Bun.which("ffmpeg") !== null;

describe("Ogg/Opus conversion", () => {
  test.skipIf(!hasFfmpeg)("converts WAV audio with ffmpeg", async () => {
    const ogg = await convertToOggOpus(silentWav());

    expect(ogg).toBeDefined();
    expect(String.fromCharCode(...ogg!.slice(0, 4))).toBe("OggS");
  });

  test.skipIf(!hasFfmpeg)("converts a WAV server response when opus was requested", async () => {
    mockFetch(
      async () =>
        new Response(silentWav(), {
          status: 200,
          headers: { "Content-Type": "audio/wav" },
        }),
    );

    const provider = new QwenTtsProvider({
      baseUrl: "http://tts.test/v1",
      model: "tts-1",
      voiceId: "Ryan",
      outputFormat: "opus",
    });

    const audio = await provider.synthesize({ text: "x" });

    expect(audio.mimeType).toBe("audio/ogg");
    expect(audio.extension).toBe("ogg");
    expect(String.fromCharCode(...audio.data.slice(0, 4))).toBe("OggS");
  });
});
