import { ConfigurationError } from "../../core/errors.ts";
import type {
  DeliveryChannelSender,
  DeliverySentMessage,
  DeliveryTextInput,
  DeliveryVoiceInput,
} from "../../capabilities/delivery/DeliveryChannel.ts";
import { MatrixClient, normalizeMatrixUserId } from "../messaging/MatrixClient.ts";
import { buildVoiceContent } from "../messaging/MatrixMessagingProvider.ts";

export interface MatrixChannelConfig {
  homeserverUrl?: string;
  roomId?: string;
  /** Matrix user id (@user:server) to deliver to as a direct message. */
  dmUserId?: string;
  accessToken?: string;
  username?: string;
  password?: string;
  allowedSenders?: string[];
}

/**
 * Extracts (and type-checks) the Matrix-specific fields of a stored channel
 * config record. Returns undefined when the config holds no homeserver.
 * `allowedSenders` is accepted as a comma-separated string (the UI form) or
 * as a string array (older records).
 */
export function matrixChannelConfig(
  config: Record<string, unknown> | undefined,
): MatrixChannelConfig | undefined {
  if (!config) return undefined;
  const str = (key: string): string | undefined =>
    typeof config[key] === "string" && (config[key] as string).trim()
      ? (config[key] as string).trim()
      : undefined;
  const homeserverUrl = str("homeserverUrl");
  if (!homeserverUrl) return undefined;

  let allowedSenders: string[] | undefined;
  if (typeof config.allowedSenders === "string") {
    allowedSenders = config.allowedSenders
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  } else if (Array.isArray(config.allowedSenders)) {
    allowedSenders = (config.allowedSenders as unknown[]).filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0,
    );
  }

  return {
    homeserverUrl,
    roomId: str("roomId"),
    dmUserId: str("dmUserId"),
    accessToken: str("accessToken"),
    username: str("username"),
    password: str("password"),
    ...(allowedSenders?.length ? { allowedSenders } : {}),
  };
}

/**
 * A per-channel Matrix sender: text as m.text (optionally formatted), voice as
 * MSC3245 audio. Delivers to a fixed room (`roomId`) or to a person
 * (`dmUserId`), in which case the bot opens or reuses the DM room on first use.
 */
export class MatrixDeliveryChannel implements DeliveryChannelSender {
  readonly name = "matrix";

  private readonly client: MatrixClient;
  private readonly roomId?: string;
  private readonly dmUserId?: string;
  private resolvedRoomId?: string;

  constructor(config: MatrixChannelConfig) {
    this.roomId = config.roomId;
    this.dmUserId = config.dmUserId ? normalizeMatrixUserId(config.dmUserId) : undefined;
    this.client = new MatrixClient({
      homeserverUrl: config.homeserverUrl,
      accessToken: config.accessToken,
      username: config.username,
      password: config.password,
    });
    this.client.assertConfigured(this.roomId);
    if (!this.roomId && !this.dmUserId) {
      throw new ConfigurationError("Matrix channel needs a roomId or a DM user to deliver to");
    }
  }

  /** Identity + membership in the target room (same check the provider does). */
  async verify(): Promise<string> {
    const detail = await this.client.verify(await this.ensureRoom());
    return this.dmUserId ? `${detail} (DM with ${this.dmUserId})` : detail;
  }

  async sendText(input: DeliveryTextInput): Promise<DeliverySentMessage> {
    const roomId = await this.ensureRoom();
    const content: Record<string, unknown> = {
      msgtype: "m.text",
      body: input.text,
    };
    if (input.html) {
      content.format = "org.matrix.custom.html";
      content.formatted_body = input.html;
    }
    const eventId = await this.client.sendMessage(roomId, "m.room.message", content);
    return { eventId };
  }

  async sendVoice(input: DeliveryVoiceInput): Promise<DeliverySentMessage> {
    const roomId = await this.ensureRoom();
    const contentUri = await this.uploadMedia(input);
    const eventId = await this.client.sendMessage(
      roomId,
      "m.room.message",
      buildVoiceContent(
        {
          kind: "voice",
          audio: input.audio,
          mimeType: input.mimeType,
          filename: input.filename,
          caption: input.caption,
        },
        contentUri,
      ),
    );
    return { eventId };
  }

  /** Resolves the stored room id, opening the DM room on first use. */
  private async ensureRoom(): Promise<string> {
    if (this.resolvedRoomId) return this.resolvedRoomId;
    const roomId =
      this.roomId ??
      (this.dmUserId ? await this.client.ensureDirectRoom(this.dmUserId) : undefined);
    if (!roomId) {
      throw new ConfigurationError("Matrix channel needs a roomId or a DM user to deliver to");
    }
    this.resolvedRoomId = roomId;
    return roomId;
  }

  private async uploadMedia(input: DeliveryVoiceInput): Promise<string> {
    const filename = encodeURIComponent(input.filename);
    const body = input.audio.slice().buffer;
    // The v1 endpoint first; the legacy fallback lives in MatrixClient's
    // request path only for auth retries, so mirror the provider's 404/405/400
    // fallback here.
    try {
      const response = await this.client.request<{ content_uri: string }>(
        "POST",
        `/_matrix/client/v1/media/upload?filename=${filename}`,
        { headers: { "Content-Type": input.mimeType }, body },
      );
      return response.content_uri;
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (![404, 405, 400].includes(status ?? 0)) throw error;
    }

    const response = await this.client.request<{ content_uri: string }>(
      "POST",
      `/_matrix/media/v3/upload?filename=${filename}`,
      { headers: { "Content-Type": input.mimeType }, body },
    );
    return response.content_uri;
  }
}
