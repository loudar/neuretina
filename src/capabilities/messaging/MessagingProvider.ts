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
 * (credentials, target channel) without sending a real message.
 */
export interface VerifiableMessagingProvider extends MessagingProvider {
  verify(): Promise<string>;
}

export function isVerifiable(
  provider: MessagingProvider,
): provider is VerifiableMessagingProvider {
  return typeof (provider as Partial<VerifiableMessagingProvider>).verify === "function";
}
