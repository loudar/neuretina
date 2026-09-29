import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import { requestRaw } from "../../infra/http/request.ts";
import type {
  SpeechAudio,
  SpeechRequest,
  TextToSpeechProvider,
} from "../../capabilities/tts/TtsProvider.ts";

export interface ElevenLabsTtsOptions {
  apiKey?: string;
  baseUrl: string;
  modelId: string;
  voiceId: string;
  outputFormat: string;
  /**
   * Speaking rate (0.7–1.2). Models in the Eleven v4 family ignore this;
   * e.g. eleven_turbo_v2_5 honors it.
   */
  speed?: number;
  maxCharsPerRequest?: number;
}

export class ElevenLabsTtsProvider implements TextToSpeechProvider {
  readonly name = "elevenlabs";
  readonly defaultVoiceId: string;

  constructor(private readonly options: ElevenLabsTtsOptions) {
    this.defaultVoiceId = options.voiceId;
  }

  async synthesize(request: SpeechRequest): Promise<SpeechAudio> {
    if (!this.options.apiKey) {
      throw new ConfigurationError(
        "ElevenLabs is not configured. Set KEY_ELEVENLABS to a valid API key.",
      );
    }

    const voiceId = request.voiceId ?? this.options.voiceId;
    const modelId = request.modelId ?? this.options.modelId;
    const outputFormat = request.outputFormat ?? this.options.outputFormat;
    const chunks = splitText(request.text, this.options.maxCharsPerRequest ?? 2600);

    const parts: Uint8Array[] = [];
    for (const [index, chunk] of chunks.entries()) {
      parts.push(
        await this.synthesizeChunk({
          voiceId,
          modelId,
          outputFormat,
          text: chunk,
          previousText: index > 0 ? chunks[index - 1] : undefined,
        }),
      );
    }

    const data = concatBytes(parts);
    const format = describeFormat(outputFormat);

    return {
      data,
      mimeType: format.mimeType,
      extension: format.extension,
      durationMs: format.bytesPerSecond ? Math.round((data.byteLength / format.bytesPerSecond) * 1000) : undefined,
    };
  }

  private async synthesizeChunk(input: {
    voiceId: string;
    modelId: string;
    outputFormat: string;
    text: string;
    previousText?: string;
  }): Promise<Uint8Array> {
    const url = `${this.options.baseUrl}/v1/text-to-speech/${encodeURIComponent(input.voiceId)}?output_format=${encodeURIComponent(input.outputFormat)}`;

    // Transient 401s and rate limits are retried with backoff.
    const response = await requestRaw(
      this.name,
      url,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.options.apiKey!,
          "Content-Type": "application/json",
          Accept: "audio/*",
        },
        body: JSON.stringify({
          text: input.text,
          model_id: input.modelId,
          ...(input.previousText ? { previous_text: input.previousText } : {}),
          ...(this.options.speed !== undefined && this.options.speed !== 1
            ? { voice_settings: { speed: this.options.speed } }
            : {}),
        }),
      },
      { retries: 2 },
    );

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new ProviderError(this.name, "ElevenLabs returned an empty audio response");
    }
    return new Uint8Array(buffer);
  }
}

export function splitText(text: string, maxChars: number): string[] {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return [normalized];

  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (const piece of hardSplit(sentence, maxChars)) chunks.push(piece);
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

function hardSplit(text: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let remaining = text;
  while (remaining.length > maxChars) {
    const window = remaining.slice(0, maxChars);
    const breakAt = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
    const cut = breakAt > maxChars * 0.5 ? breakAt + 1 : maxChars;
    pieces.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut);
  }
  if (remaining.trim()) pieces.push(remaining.trim());
  return pieces;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

interface FormatInfo {
  mimeType: string;
  extension: string;
  bytesPerSecond?: number;
}

export function describeFormat(outputFormat: string): FormatInfo {
  const [codec, , bitrate] = outputFormat.split("_");
  const bitrateBps = bitrate ? Number(bitrate) * 1000 : undefined;

  switch (codec) {
    case "mp3":
      return { mimeType: "audio/mpeg", extension: "mp3", bytesPerSecond: (bitrateBps ?? 128000) / 8 };
    case "opus":
      return { mimeType: "audio/ogg", extension: "ogg", bytesPerSecond: (bitrateBps ?? 128000) / 8 };
    case "wav":
      return { mimeType: "audio/wav", extension: "wav" };
    case "pcm":
      return { mimeType: "audio/L16", extension: "pcm" };
    default:
      return { mimeType: "application/octet-stream", extension: "bin" };
  }
}
