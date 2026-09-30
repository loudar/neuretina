import { errorMessage, ValidationError } from "../core/errors.ts";
import type { EventBus } from "../core/events/EventBus.ts";
import type { Logger } from "../core/logger.ts";
import type { DeliveryChannelSender } from "../capabilities/delivery/DeliveryChannel.ts";
import { createDeliverySender } from "../providers/delivery/DeliverySenders.ts";
import type {
  DeliveryChannel,
  DeliveryKind,
  DeliveryRecord,
  DeliveryStatus,
  DeliveryStore,
} from "../domain/delivery/DeliveryRepository.ts";

export interface DeliverInput {
  briefId: string;
  runId?: string;
  /**
   * Workflow whose attached channels receive the message; defaults to the
   * briefing workflow. User workflow runs pass their own id.
   */
  workflow?: string;
  /**
   * Explicit channel ids; when absent, every enabled channel attached to the
   * workflow receives the brief.
   */
  channels?: string[];
  /** Which passes to run; defaults to text + voice. */
  kinds?: DeliveryKind[];
  /** Plain-text summary (the compiled brief with source links). */
  summary: string;
  /** Pre-rendered HTML for channels that support it (Matrix, email). */
  html?: string;
  /** Spoken version of the brief; used as the voice message's text body. */
  narration?: string;
  audio?: Uint8Array;
  audioMime?: string;
}

/** Aggregate per-channel outcome: sent when every executed pass succeeded. */
export interface DeliveryAttempt {
  channelId: string;
  status: "sent" | "failed";
  eventId?: string;
  error?: string;
}

export interface DeliveryServiceDeps {
  store: DeliveryStore;
  bus: EventBus;
  logger: Logger;
  /** Sender factory; injectable for tests. */
  createSender?: (channel: DeliveryChannel) => DeliveryChannelSender;
}

/** What consumers need from delivery: route a brief through channels. */
export interface DeliveryRouter {
  deliver(input: DeliverInput): Promise<DeliveryAttempt[]>;
}

const BRIEFING_WORKFLOW = "briefing";

interface PassResult {
  status: "sent" | "failed";
  eventId?: string;
  error?: string;
}

/**
 * Routes a brief through the delivery channels attached to it: records one
 * delivery row per channel and pass (text/voice), publishes `delivery.status`
 * per attempt and never lets one failing channel abort the others.
 */
export class DeliveryService implements DeliveryRouter {
  private readonly buildSender: (channel: DeliveryChannel) => DeliveryChannelSender;

  constructor(private readonly deps: DeliveryServiceDeps) {
    this.buildSender =
      deps.createSender ?? ((channel) => createDeliverySender(channel.type, channel.config));
  }

  async deliver(input: DeliverInput): Promise<DeliveryAttempt[]> {
    const channels = this.resolveChannels(input);
    const kinds = input.kinds ?? (["text", "voice"] as DeliveryKind[]);
    const audio = input.audio && input.audio.byteLength > 0 ? input.audio : undefined;

    const results: DeliveryAttempt[] = [];
    for (const channel of channels) {
      results.push(await this.deliverTo(channel, input, kinds, Boolean(audio)));
    }
    return results;
  }

  /** Resolves the target channels or throws when an explicit id is unusable. */
  private resolveChannels(input: DeliverInput): DeliveryChannel[] {
    if (input.channels) {
      const ids = [...new Set(input.channels)];
      return ids.map((id) => {
        const channel = this.deps.store.channel(id);
        if (!channel.enabled) {
          throw new ValidationError(
            `Delivery channel "${channel.name}" (${channel.id}) is disabled`,
          );
        }
        return channel;
      });
    }

    const attached = new Set(
      this.deps.store
        .attachments()
        .filter((attachment) => attachment.workflow === (input.workflow ?? BRIEFING_WORKFLOW))
        .map((attachment) => attachment.channelId),
    );
    return this.deps.store.channels().filter((channel) => channel.enabled && attached.has(channel.id));
  }

  /** Text first, then voice; one channel's failure never stops the others. */
  private async deliverTo(
    channel: DeliveryChannel,
    input: DeliverInput,
    kinds: DeliveryKind[],
    hasAudio: boolean,
  ): Promise<DeliveryAttempt> {
    let passes: PassResult[];
    try {
      const sender = this.buildSender(channel);
      const passesOut: PassResult[] = [];
      if (kinds.includes("text")) {
        passesOut.push(
          await this.pass(channel, input, "text", () =>
            sender.sendText({ text: input.summary, html: input.html }),
          ),
        );
      }
      if (hasAudio && kinds.includes("voice")) {
        const mime = input.audioMime ?? "audio/ogg";
        passesOut.push(
          await this.pass(channel, input, "voice", () =>
            sender.sendVoice({
              audio: input.audio!,
              mimeType: mime,
              filename: `morning-brief-${dateStamp()}.${extensionFor(mime)}`,
              caption: `Morning brief – ${dateStamp()}`,
              text: input.narration ?? input.summary,
            }),
          ),
        );
      }
      passes = passesOut;
    } catch (error) {
      // The sender could not even be built (bad channel config): fail every
      // requested pass for this channel so the UI shows why.
      const message = errorMessage(error);
      passes = [];
      for (const kind of kinds.filter((entry) => entry === "text" || (hasAudio && entry === "voice"))) {
        passes.push(await this.failPass(channel, input, kind, message));
      }
    }

    const failed = passes.find((pass) => pass.status === "failed");
    const lastSent = [...passes].reverse().find((pass) => pass.status === "sent");
    return {
      channelId: channel.id,
      status: failed ? "failed" : "sent",
      ...(lastSent?.eventId ? { eventId: lastSent.eventId } : {}),
      ...(failed?.error ? { error: failed.error } : {}),
    };
  }

  private async pass(
    channel: DeliveryChannel,
    input: DeliverInput,
    kind: DeliveryKind,
    send: () => Promise<{ eventId: string }>,
  ): Promise<PassResult> {
    const row = this.deps.store.record({
      briefId: input.briefId,
      runId: input.runId,
      channelId: channel.id,
      kind,
    });
    this.publish(row, input);
    try {
      const sent = await send();
      const completed = this.deps.store.complete(row.id, {
        status: "sent",
        eventId: sent.eventId,
      });
      this.publish(completed, input);
      this.deps.logger.info("delivery sent", {
        channelId: channel.id,
        channelType: channel.type,
        kind,
        eventId: completed.eventId,
      });
      return { status: "sent", eventId: completed.eventId };
    } catch (error) {
      return this.completeFailed(row, input, errorMessage(error));
    }
  }

  /** A pre-send failure (e.g. unusable channel config): record and report it. */
  private async failPass(
    channel: DeliveryChannel,
    input: DeliverInput,
    kind: DeliveryKind,
    message: string,
  ): Promise<PassResult> {
    const row = this.deps.store.record({
      briefId: input.briefId,
      runId: input.runId,
      channelId: channel.id,
      kind,
    });
    this.publish(row, input);
    return this.completeFailed(row, input, message);
  }

  private async completeFailed(
    row: DeliveryRecord,
    input: DeliverInput,
    message: string,
  ): Promise<PassResult> {
    const completed = this.deps.store.complete(row.id, { status: "failed", error: message });
    this.publish(completed, input);
    this.deps.logger.warn("delivery failed", {
      channelId: row.channelId,
      kind: row.kind,
      error: message,
    });
    return { status: "failed", error: message };
  }

  private publish(record: DeliveryRecord, input: DeliverInput): void {
    const payload: {
      briefId: string;
      runId?: string;
      channelId: string;
      kind: DeliveryKind;
      status: DeliveryStatus;
      eventId?: string;
      error?: string;
    } = {
      briefId: record.briefId,
      channelId: record.channelId,
      kind: record.kind,
      status: record.status,
    };
    if (record.runId) payload.runId = record.runId;
    if (record.eventId) payload.eventId = record.eventId;
    if (record.error) payload.error = record.error;

    this.deps.bus.publish("delivery.status", payload, {
      source: "delivery",
      correlationId: input.runId,
    });
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function extensionFor(mimeType: string): string {
  if (mimeType.includes("ogg") || mimeType.includes("opus")) return "ogg";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "bin";
}
