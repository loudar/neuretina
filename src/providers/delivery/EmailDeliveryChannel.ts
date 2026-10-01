import { createTransport, type Transporter } from "nodemailer";
import { ConfigurationError } from "../../core/errors.ts";
import { numberField, stringField } from "../../core/records.ts";
import type {
  DeliveryChannelSender,
  DeliverySentMessage,
  DeliveryTextInput,
  DeliveryVoiceInput,
} from "../../capabilities/delivery/DeliveryChannel.ts";

export interface EmailChannelConfig {
  host?: string;
  port?: number;
  /** Implicit TLS (465); false uses STARTTLS/plain (587). Defaults to true. */
  secure?: boolean;
  username?: string;
  password?: string;
  from?: string;
  to?: string;
}

/** Extracts (and type-checks) the SMTP fields of a stored channel config. */
export function emailChannelConfig(
  config: Record<string, unknown> | undefined,
): EmailChannelConfig {
  const record = config ?? {};
  return {
    host: stringField(record, "host"),
    port: numberField(record, "port"),
    secure: typeof record.secure === "boolean" ? record.secure : undefined,
    username: stringField(record, "username"),
    password: stringField(record, "password"),
    from: stringField(record, "from"),
    to: stringField(record, "to"),
  };
}

/** Subject line derived from the message: its first heading/line, capped. */
function subjectFrom(text: string, fallback: string): string {
  const line = text
    .split("\n")
    .map((entry) => entry.replace(/^#{1,6}\s*/, "").replace(/[*_`>]/g, "").trim())
    .find((entry) => entry.length > 0);
  if (!line) return fallback;
  return line.length <= 100 ? line : `${line.slice(0, 99)}…`;
}

/** SMTP delivery via nodemailer; voice messages go out as audio attachments. */
export class EmailDeliveryChannel implements DeliveryChannelSender {
  readonly name = "email";

  private readonly transporter: Transporter;
  private readonly from: string;
  private readonly to: string;

  constructor(config: EmailChannelConfig) {
    if (!config.host) {
      throw new ConfigurationError("Email channel is missing its SMTP host");
    }
    if (!config.from || !config.to) {
      throw new ConfigurationError("Email channel needs both a from and a to address");
    }

    this.from = config.from;
    this.to = config.to;
    // Port 587 means STARTTLS for essentially every provider; implicit TLS
    // only happens on 465 (the default when no port is configured).
    const port = config.port ?? 465;
    this.transporter = createTransport({
      host: config.host,
      port,
      secure: port === 587 ? false : (config.secure ?? true),
      ...(config.username ? { auth: { user: config.username, pass: config.password ?? "" } } : {}),
    });
  }

  async verify(): Promise<string> {
    await this.transporter.verify();
    const host = (this.transporter.options as { host?: string }).host;
    return `SMTP ${host} reachable`;
  }

  async sendText(input: DeliveryTextInput): Promise<DeliverySentMessage> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: this.to,
      subject: subjectFrom(input.text, "Neuretina update"),
      text: input.text,
      ...(input.html ? { html: input.html } : {}),
    });
    return { eventId: info.messageId };
  }

  async sendVoice(input: DeliveryVoiceInput): Promise<DeliverySentMessage> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: this.to,
      subject: input.caption || subjectFrom(input.text, "Neuretina audio"),
      text: input.text,
      attachments: [
        {
          filename: input.filename,
          content: Buffer.from(input.audio),
          contentType: input.mimeType,
        },
      ],
    });
    return { eventId: info.messageId };
  }
}


