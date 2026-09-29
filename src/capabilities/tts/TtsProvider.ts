export interface SpeechRequest {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: string;
}

export interface SpeechAudio {
  data: Uint8Array;
  mimeType: string;
  extension: string;
  durationMs?: number;
}

export interface TextToSpeechProvider {
  readonly name: string;
  readonly defaultVoiceId: string;
  synthesize(request: SpeechRequest): Promise<SpeechAudio>;
}
