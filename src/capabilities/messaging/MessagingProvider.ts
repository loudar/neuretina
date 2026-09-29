import type { Verifiable } from "../../core/verifiable.ts";

export interface OutboundTextMessage {
  kind: "text";
  text: string;
  /** Optional pre-rendered HTML version of the text (e.g. Matrix formatted_body). */
  html?: string;
  channel?: string;
}

export interface OutboundVoiceMessage {
  kind: "voice";
  audio: Uint8Array;
  mimeType: string;
  durationMs?: number;
  filename: string;
  caption?: string;
  channel?: string;
}

export type OutboundMessage = OutboundTextMessage | OutboundVoiceMessage;

export interface SentMessage {
  id: string;
  channel: string;
  kind: OutboundMessage["kind"];
}

export interface MessagingProvider {
  readonly name: string;
  readonly defaultChannel?: string;
  send(message: OutboundMessage): Promise<SentMessage>;
}

/**
 * Optional capability: providers that can actively verify their configuration
 * (credentials, target channel) without sending a real message. Check it with
 * `isVerifiable` from `src/core/verifiable.ts`.
 */
export interface VerifiableMessagingProvider extends MessagingProvider, Verifiable {}
