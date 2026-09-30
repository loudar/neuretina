import { ConfigurationError } from "../../core/errors.ts";
import type {
  DeliveryChannelSender,
  DeliverySentMessage,
  DeliveryTextInput,
  DeliveryVoiceInput,
} from "../../capabilities/delivery/DeliveryChannel.ts";
import { requestJson } from "../../infra/http/request.ts";

export interface DiscordChannelConfig {
  webhookUrl?: string;
}

const MAX_CONTENT_CHARS = 2000;

/** Discord limits message content to 2000 characters. */
function truncateContent(text: string): string {
  return text.length <= MAX_CONTENT_CHARS ? text : `${text.slice(0, MAX_CONTENT_CHARS - 1)}…`;
}

interface WebhookInfo {
  id?: string;
}

/**
 * A Discord webhook sender. Voice is not supported natively: the voice pass
 * delivers the text summary with a note that audio only reaches Matrix
 * channels — the delivery is still recorded as sent.
 */
export class DiscordDeliveryChannel implements DeliveryChannelSender {
  readonly name = "discord";
  private readonly webhookUrl: string;

  constructor(config: DiscordChannelConfig) {
    const url = config.webhookUrl?.trim();
    if (!url) {
      throw new ConfigurationError("Discord channel is missing its webhookUrl");
    }
    this.webhookUrl = url;
  }

  async verify(): Promise<string> {
    const info = await requestJson<WebhookInfo>("discord", this.webhookUrl, { method: "GET" });
    if (!info.id) {
      throw new ConfigurationError("The webhook URL did not return a webhook object");
    }
    return `Webhook ${info.id} reachable`;
  }

  async sendText(input: DeliveryTextInput): Promise<DeliverySentMessage> {
    return this.postContent(truncateContent(input.text));
  }

  async sendVoice(input: DeliveryVoiceInput): Promise<DeliverySentMessage> {
    const note =
      "\n\n_(This channel receives text only — the voice message was delivered to the Matrix channels.)_";
    return this.postContent(truncateContent(`${input.text}${note}`));
  }

  private async postContent(content: string): Promise<DeliverySentMessage> {
    // `wait=true` makes Discord answer with the created message (and its id)
    // instead of an empty 204.
    const url = this.webhookUrl.includes("?") ? `${this.webhookUrl}&wait=true` : `${this.webhookUrl}?wait=true`;
    const sent = await requestJson<{ id?: string }>("discord", url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!sent.id) {
      // Slack-style webhooks answer "ok" without an id; keep delivering.
      return { eventId: `discord-${crypto.randomUUID()}` };
    }
    return { eventId: sent.id };
  }
}
