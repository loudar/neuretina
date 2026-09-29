import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import type {
  MessagingProvider,
  OutboundMessage,
  OutboundVoiceMessage,
  SentMessage,
} from "../../capabilities/messaging/MessagingProvider.ts";
import { MatrixClient, type MatrixClientOptions } from "./MatrixClient.ts";

export interface MatrixMessagingOptions extends MatrixClientOptions {
  roomId?: string;
  /** Share a client with other Matrix consumers (e.g. the command listener). */
  client?: MatrixClient;
}

interface UploadResponse {
  content_uri: string;
}

export class MatrixMessagingProvider implements MessagingProvider {
  readonly name = "matrix";
  readonly defaultChannel?: string;

  private readonly client: MatrixClient;

  constructor(private readonly options: MatrixMessagingOptions) {
    this.defaultChannel = options.roomId;
    this.client = options.client ?? new MatrixClient(options);
  }

  get configured(): boolean {
    return this.client.configured && Boolean(this.options.roomId);
  }

  async send(message: OutboundMessage): Promise<SentMessage> {
    const roomId = message.channel ?? this.options.roomId;
    this.assertConfigured(roomId);

    if (message.kind === "text") {
      const content: Record<string, unknown> = {
        msgtype: "m.text",
        body: message.text,
      };
      if (message.html) {
        content.format = "org.matrix.custom.html";
        content.formatted_body = message.html;
      }
      const eventId = await this.client.sendMessage(roomId!, "m.room.message", content);
      return { id: eventId, channel: roomId!, kind: "text" };
    }

    const contentUri = await this.uploadMedia(message);
    const content = buildVoiceContent(message, contentUri);
    const eventId = await this.client.sendMessage(roomId!, "m.room.message", content);
    return { id: eventId, channel: roomId!, kind: "voice" };
  }

  /** Active pre-flight: identity + membership in the target room. */
  async verify(): Promise<string> {
    const roomId = this.options.roomId;
    this.assertConfigured(roomId);
    return this.client.verify(roomId!);
  }

  private assertConfigured(roomId?: string): void {
    if (!this.options.roomId && !roomId) {
      throw new ConfigurationError("Matrix room is not configured. Set MATRIX_ROOM_ID.");
    }
    this.client.assertConfigured(roomId);
  }

  private async uploadMedia(message: OutboundVoiceMessage): Promise<string> {
    const filename = encodeURIComponent(message.filename);
    const body = message.audio.slice().buffer;

    try {
      const response = await this.client.request<UploadResponse>(
        "POST",
        `/_matrix/client/v1/media/upload?filename=${filename}`,
        { headers: { "Content-Type": message.mimeType }, body },
      );
      return response.content_uri;
    } catch (error) {
      if (!(error instanceof ProviderError) || ![404, 405, 400].includes(error.status ?? 0)) {
        throw error;
      }
    }

    const response = await this.client.request<UploadResponse>(
      "POST",
      `/_matrix/media/v3/upload?filename=${filename}`,
      { headers: { "Content-Type": message.mimeType }, body },
    );
    return response.content_uri;
  }
}

export function buildVoiceContent(
  message: OutboundVoiceMessage,
  contentUri: string,
): Record<string, unknown> {
  const info: Record<string, unknown> = {
    mimetype: message.mimeType,
    size: message.audio.byteLength,
  };
  if (message.durationMs !== undefined) info.duration = message.durationMs;

  const content: Record<string, unknown> = {
    msgtype: "m.audio",
    body: message.caption ?? message.filename,
    filename: message.filename,
    url: contentUri,
    info,
    "org.matrix.msc3245.voice": {},
  };

  if (message.durationMs !== undefined) {
    content["org.matrix.msc1767.audio"] = { duration: message.durationMs };
  }

  return content;
}
