import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import { requestJson, requestRaw } from "../../infra/http/request.ts";
import type {
  SpeechAudio,
  SpeechRequest,
  TextToSpeechProvider,
} from "../../capabilities/tts/TtsProvider.ts";

export interface QwenTtsOptions {
  /** Base URL of the local OpenAI-compatible server, including `/v1`. */
  baseUrl: string;
  /** Model name; most local servers accept and ignore it. */
  model: string;
  /** Preset speaker (`Ryan`, `vivian`, …) or an OpenAI alias (`alloy`, …). */
  voiceId: string;
  /** OpenAI speech format: `wav` | `mp3` | `opus` | `flac` | `aac` | `pcm`. */
  outputFormat: string;
  /** Optional language hint for multilingual servers, e.g. "English". */
  language?: string;
  speed?: number;
  /** Only needed when the local server enforces auth. */
  apiKey?: string;
}

/**
 * Speech through a local Qwen3-TTS server (vLLM-Omni, qwen3-tts-server,
 * Qwen3-TTS-Openai-Fastapi, …) speaking the OpenAI `POST /audio/speech`
 * interface. No text ever leaves the machine.
 */
export class QwenTtsProvider implements TextToSpeechProvider {
  readonly name = "qwen-tts";
  readonly defaultVoiceId: string;

  constructor(private readonly options: QwenTtsOptions) {
    this.defaultVoiceId = options.voiceId;
  }

  /** Verifies the local server is reachable (GET /models). */
  async verify(): Promise<string> {
    if (!this.options.baseUrl) {
      throw new ConfigurationError(
        "Qwen TTS is not configured. Set QWEN_TTS_BASE_URL to your local server, e.g. http://127.0.0.1:8880/v1.",
      );
    }

    const response = await requestJson<{ data?: unknown[] }>(
      this.name,
      `${this.options.baseUrl}/models`,
      {
        headers: this.options.apiKey
          ? { Authorization: `Bearer ${this.options.apiKey}` }
          : {},
      },
    );

    const models = Array.isArray(response.data) ? response.data.length : undefined;
    return `reachable${models !== undefined ? `, ${models} model(s)` : ""}`;
  }

  async synthesize(request: SpeechRequest): Promise<SpeechAudio> {
    if (!this.options.baseUrl) {
      throw new ConfigurationError(
        "Qwen TTS is not configured. Set QWEN_TTS_BASE_URL to your local server, e.g. http://127.0.0.1:8880/v1.",
      );
    }

    const format = describeSpeechFormat(request.outputFormat ?? this.options.outputFormat);
    const payload: Record<string, unknown> = {
      model: request.modelId ?? this.options.model,
      input: request.text,
      voice: request.voiceId ?? this.options.voiceId,
      response_format: format.format,
    };
    if (this.options.language) payload.language = this.options.language;
    if (this.options.speed !== undefined && this.options.speed !== 1) {
      payload.speed = this.options.speed;
    }

    const response = await requestRaw(
      this.name,
      `${this.options.baseUrl}/audio/speech`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/*",
          ...(this.options.apiKey ? { Authorization: `Bearer ${this.options.apiKey}` } : {}),
        },
        body: JSON.stringify(payload),
      },
      { retries: 2 },
    );

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0) {
      throw new ProviderError(this.name, "the local TTS server returned empty audio");
    }

    return {
      data: new Uint8Array(buffer),
      mimeType: format.mimeType,
      extension: format.extension,
    };
  }
}

interface SpeechFormat {
  format: string;
  mimeType: string;
  extension: string;
}

const FORMATS: Record<string, SpeechFormat> = {
  wav: { format: "wav", mimeType: "audio/wav", extension: "wav" },
  mp3: { format: "mp3", mimeType: "audio/mpeg", extension: "mp3" },
  // OpenAI-style "opus" is Ogg Opus, which Matrix clients render as a voice bubble.
  opus: { format: "opus", mimeType: "audio/ogg", extension: "ogg" },
  flac: { format: "flac", mimeType: "audio/flac", extension: "flac" },
  aac: { format: "aac", mimeType: "audio/aac", extension: "aac" },
  pcm: { format: "pcm", mimeType: "audio/pcm", extension: "pcm" },
};

function describeSpeechFormat(value: string): SpeechFormat {
  return FORMATS[value.toLowerCase()] ?? FORMATS.mp3!;
}
