/**
 * Delivery channel capability: a sender built from one stored delivery
 * channel's configuration (Matrix room, Discord webhook, SMTP mailbox, …).
 * Unlike `MessagingProvider` (the single legacy Matrix integration), a sender
 * is per-channel and knows nothing about reports or runs.
 */

export interface DeliverySentMessage {
  /** Provider event id of the delivered message (e.g. Matrix event id, Discord message id). */
  eventId: string;
}

export interface DeliveryTextInput {
  text: string;
  /** Optional pre-rendered HTML version of the text (Matrix formatted_body, email html). */
  html?: string;
}

export interface DeliveryVoiceInput {
  audio: Uint8Array;
  mimeType: string;
  filename: string;
  caption: string;
  /** Plain text version delivered alongside/instead of the audio when needed. */
  text: string;
}

export interface DeliveryChannelSender {
  /** Active pre-flight: credentials, target address, reachability. */
  verify(): Promise<string>;
  sendText(input: DeliveryTextInput): Promise<DeliverySentMessage>;
  sendVoice(input: DeliveryVoiceInput): Promise<DeliverySentMessage>;
}
