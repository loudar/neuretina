import { errorMessage, ProviderError } from "../../core/errors.ts";
import type { EventBus } from "../../core/events/EventBus.ts";
import type { Logger } from "../../core/logger.ts";
import type { KeyValueStore } from "../../domain/kv/KeyValueRepository.ts";
import type { ChatCommand, ChatCommandSource } from "../../capabilities/chat/ChatChannel.ts";
import type { MatrixClient } from "./MatrixClient.ts";

/** One message in a resolved reply chain (oldest first). */
export interface MatrixChainEntry {
  eventId: string;
  sender: string;
  body: string;
  fromBot: boolean;
  ts?: number;
}

/** Trigger payload for any allowed message in the room. */
export interface MatrixTriggerInput {
  channel: string;
  eventId: string;
  sender: string;
  body: string;
  /** The message quotes one of our own messages. */
  replyToBot: boolean;
  quotedEventId?: string;
  /** Resolved ancestors (oldest first) when the message is a reply. */
  chain: MatrixChainEntry[];
}

export interface MatrixTriggerResult {
  /** Text to send back as a reply; nothing is sent when omitted. */
  answer?: string;
}

export interface MatrixCommandListenerOptions {
  client: MatrixClient;
  kv: KeyValueStore;
  bus: EventBus;
  logger: Logger;
  roomId?: string;
  /** If set, only these matrix user ids may issue commands. */
  allowedSenders?: string[];
  /** Handles a parsed command and returns the reply text. */
  onCommand: (command: ChatCommand) => Promise<string>;
  /** Handles any allowed message; workflows decide whether to answer. */
  onMessage?: (input: MatrixTriggerInput) => Promise<MatrixTriggerResult | undefined>;
}

interface MatrixEvent {
  type?: string;
  sender?: string;
  event_id?: string;
  origin_server_ts?: number;
  content?: Record<string, unknown>;
}

interface SyncResponse {
  next_batch: string;
  rooms?: {
    join?: Record<string, { timeline?: { events?: MatrixEvent[] } }>;
  };
}

const SYNC_KEY = "matrix.sync_token";
const SYNC_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 5_000;
const MIN_SYNC_INTERVAL_MS = 250;
const MAX_TRACKED_OWN_MESSAGES = 200;
/** Reply-chain resolution caps: enough context, bounded cost. */
const MAX_CHAIN_EVENTS = 10;
const MAX_CHAIN_CHARS = 8000;
const FILTER = JSON.stringify({
  room: { timeline: { limit: 20, types: ["m.room.message"] } },
});

/**
 * Long-polls the Matrix /sync endpoint for text messages in the configured
 * room. Slash commands become ChatCommands; every other allowed message is
 * handed to `onMessage` (workflows decide whether to answer), with the whole
 * reply chain resolved and attached when the message is a reply. The sync
 * position is persisted, so restarts do not replay history.
 */
export class MatrixCommandListener implements ChatCommandSource {
  readonly name = "matrix";

  private running = false;
  private abort: AbortController | null = null;
  private userId: string | null = null;
  private readonly ownMessages = new Set<string>();
  private readonly ownMessageOrder: string[] = [];

  constructor(private readonly options: MatrixCommandListenerOptions) {
    // Messages the bot sends through the messaging provider (briefs, notices,
    // re-sends) count as "ours" for follow-up replies too.
    options.bus.subscribeTopics(["message.text.sent", "message.voice.sent"], (event) => {
      const eventId = (event.payload as { eventId?: unknown }).eventId;
      if (typeof eventId === "string") this.trackOwnMessage(eventId);
    });
  }

  get roomId(): string | undefined {
    return this.options.roomId;
  }

  async start(): Promise<void> {
    if (this.running) return;

    const { client, roomId, logger } = this.options;
    if (!client.configured || !roomId) {
      logger.info("command listener disabled (Matrix room not configured)");
      return;
    }

    this.userId = await client.ensureUserId();
    this.running = true;
    logger.info("command listener started", { roomId });

    void this.loop().catch((error) => {
      logger.error("command listener crashed", { error: errorMessage(error) });
    });
  }

  stop(): void {
    this.running = false;
    this.abort?.abort();
  }

  private async loop(): Promise<void> {
    await this.initialSync();

    while (this.running) {
      const startedAt = Date.now();
      try {
        const response = await this.sync();
        this.options.kv.set(SYNC_KEY, response.next_batch);
        await this.process(response);
      } catch (error) {
        if (!this.running) break;
        if (error instanceof Error && error.name === "AbortError") continue;

        this.options.logger.warn("matrix sync failed", { error: errorMessage(error) });

        // A sync position can become invalid after a re-login; reset and
        // skip anything that happened while the listener was away.
        if (error instanceof ProviderError && (error.status === 400 || error.status === 401)) {
          this.options.kv.delete(SYNC_KEY);
          await this.initialSync().catch(() => undefined);
        }

        await Bun.sleep(RETRY_DELAY_MS);
      }

      // Guard against tight loops if a server answers syncs instantly.
      const elapsed = Date.now() - startedAt;
      if (this.running && elapsed < MIN_SYNC_INTERVAL_MS) {
        await Bun.sleep(MIN_SYNC_INTERVAL_MS - elapsed);
      }
    }
  }

  private async initialSync(): Promise<void> {
    if (this.options.kv.get(SYNC_KEY)) return;
    const response = await this.requestSync(0);
    this.options.kv.set(SYNC_KEY, response.next_batch);
  }

  private async sync(): Promise<SyncResponse> {
    return this.requestSync(SYNC_TIMEOUT_MS);
  }

  private async requestSync(timeoutMs: number): Promise<SyncResponse> {
    const controller = new AbortController();
    this.abort = controller;

    const since = this.options.kv.get(SYNC_KEY);
    const params = new URLSearchParams({
      timeout: String(timeoutMs),
      filter: FILTER,
    });
    if (since) params.set("since", since);

    return this.options.client.request<SyncResponse>(
      "GET",
      `/_matrix/client/v3/sync?${params.toString()}`,
      { signal: controller.signal },
    );
  }

  private async process(response: SyncResponse): Promise<void> {
    const { roomId, client, bus, logger } = this.options;
    const room = response.rooms?.join?.[roomId!];
    if (!room) return;

    for (const event of room.timeline?.events ?? []) {
      if (event.type !== "m.room.message") continue;
      if (!event.sender || event.sender === this.userId) continue;
      if (!event.event_id) continue;

      if (this.options.allowedSenders?.length && !this.options.allowedSenders.includes(event.sender)) {
        logger.warn("ignoring message from non-allowed sender", { sender: event.sender });
        continue;
      }

      const content = event.content ?? {};
      if (content.msgtype !== "m.text" || typeof content.body !== "string") continue;

      const body = stripReplyFallback(content.body);
      const quotedId = quotedEventIdOf(content);

      // Commands are plain messages (not replies).
      const parsed = quotedId ? null : parseChatCommand(body);
      if (parsed) {
        await this.handleCommand(parsed, event);
        continue;
      }

      await this.handleMessage(body, event, quotedId);
    }
  }

  private async handleCommand(
    parsed: { command: string; args: string },
    event: MatrixEvent,
  ): Promise<void> {
    const { roomId, client, bus, logger } = this.options;
    const command: ChatCommand = {
      channel: roomId!,
      sender: event.sender!,
      command: parsed.command,
      args: parsed.args,
      raw: stripReplyFallback(String(event.content?.body ?? "")).trim(),
    };

    bus.publish(
      "chat.command.received",
      { channel: command.channel, sender: command.sender, command: command.command, args: command.args },
      { source: "matrix" },
    );

    try {
      const reply = await this.options.onCommand(command);
      this.trackOwnMessage(
        await client.sendMessage(command.channel, "m.room.message", {
          msgtype: "m.text",
          body: reply,
        }),
      );
      bus.publish(
        "chat.command.handled",
        { channel: command.channel, command: command.command, reply: reply.slice(0, 300) },
        { source: "matrix" },
      );
    } catch (error) {
      const message = errorMessage(error);
      bus.publish(
        "chat.command.failed",
        { channel: command.channel, command: command.command, error: message },
        { source: "matrix" },
      );
      logger.error("command failed", { command: command.command, error: message });
      await client
        .sendMessage(command.channel, "m.room.message", {
          msgtype: "m.text",
          body: `Command /${command.command} failed: ${message}`,
        })
        .catch(() => undefined);
    }
  }

  private async handleMessage(
    body: string,
    event: MatrixEvent,
    quotedId: string | undefined,
  ): Promise<void> {
    const { roomId, client, bus, logger, onMessage } = this.options;
    if (!onMessage) return;

    const trimmed = body.trim();
    if (!trimmed) return;

    const channel = roomId!;
    const sender = event.sender!;
    const replyToBot = quotedId ? await this.quotedIsFromBot(channel, quotedId) : false;
    const chain = quotedId ? await this.resolveReplyChain(channel, quotedId) : [];

    const input: MatrixTriggerInput = {
      channel,
      eventId: event.event_id!,
      sender,
      body: trimmed,
      replyToBot,
      ...(quotedId ? { quotedEventId: quotedId } : {}),
      chain,
    };

    bus.publish(
      "chat.message.received",
      { channel, sender, body: trimmed.slice(0, 500), replyToBot },
      { source: "matrix" },
    );
    if (replyToBot) {
      bus.publish(
        "chat.question.received",
        { channel, sender, question: trimmed.slice(0, 500) },
        { source: "matrix" },
      );
    }

    try {
      const result = await onMessage(input);
      if (!result?.answer) return;

      this.trackOwnMessage(
        await client.sendMessage(channel, "m.room.message", {
          msgtype: "m.text",
          body: result.answer,
          "m.relates_to": { "m.in_reply_to": { event_id: event.event_id! } },
        }),
      );
      bus.publish(
        "chat.question.answered",
        { channel, sender, question: trimmed.slice(0, 300), answer: result.answer.slice(0, 300) },
        { source: "matrix" },
      );
    } catch (error) {
      const message = errorMessage(error);
      bus.publish(
        "chat.question.failed",
        { channel, sender, question: trimmed.slice(0, 300), error: message },
        { source: "matrix" },
      );
      logger.error("message handling failed", { error: message });
      await client
        .sendMessage(channel, "m.room.message", {
          msgtype: "m.text",
          body: `Sorry, I couldn't answer that: ${message}`,
          "m.relates_to": { "m.in_reply_to": { event_id: event.event_id! } },
        })
        .catch(() => undefined);
    }
  }

  /** The quoted message was sent by us (tracked directly or by sender id). */
  private async quotedIsFromBot(channel: string, eventId: string): Promise<boolean> {
    if (this.isOwnMessage(eventId)) return true;
    try {
      const quoted = await this.fetchEvent(channel, eventId);
      return Boolean(quoted.sender && this.userId && quoted.sender === this.userId);
    } catch {
      return false;
    }
  }

  /**
   * Walks m.in_reply_to from the quoted message upwards, oldest first, capped
   * by count and total characters. Includes our own messages so answers keep
   * the thread's meaning.
   */
  private async resolveReplyChain(
    channel: string,
    startEventId: string,
  ): Promise<MatrixChainEntry[]> {
    const chain: MatrixChainEntry[] = [];
    let currentId: string | undefined = startEventId;
    let chars = 0;

    for (let depth = 0; depth < MAX_CHAIN_EVENTS && currentId; depth++) {
      let event: MatrixEvent;
      try {
        event = await this.fetchEvent(channel, currentId);
      } catch {
        break;
      }

      const content = event.content ?? {};
      const body = typeof content.body === "string" ? stripReplyFallback(content.body) : "";
      if (body) {
        chain.unshift({
          eventId: event.event_id ?? currentId,
          sender: event.sender ?? "unknown",
          body: body.slice(0, 2000),
          fromBot: Boolean(event.sender && this.userId && event.sender === this.userId),
          ts: event.origin_server_ts,
        });
        chars += body.length;
        if (chars >= MAX_CHAIN_CHARS) break;
      }

      currentId = quotedEventIdOf(content);
    }

    return chain;
  }

  private fetchEvent(channel: string, eventId: string): Promise<MatrixEvent> {
    return this.options.client.request<MatrixEvent>(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(channel)}/event/${encodeURIComponent(eventId)}`,
    );
  }

  private isOwnMessage(eventId: string): boolean {
    return this.ownMessages.has(eventId);
  }

  private trackOwnMessage(eventId: string): void {
    this.ownMessages.add(eventId);
    this.ownMessageOrder.push(eventId);
    while (this.ownMessageOrder.length > MAX_TRACKED_OWN_MESSAGES) {
      const oldest = this.ownMessageOrder.shift();
      if (oldest) this.ownMessages.delete(oldest);
    }
  }
}

/** Matrix reply bodies carry a "> <@user> …" quote fallback; drop it. */
export function stripReplyFallback(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index]!.startsWith(">")) index += 1;
  if (index > 0 && lines[index] === "") index += 1;
  return lines.slice(index).join("\n").trim();
}

/**
 * The event a reply targets. Per the Matrix spec a rich reply carries
 * `"m.in_reply_to": { event_id }` directly under `m.relates_to` (no rel_type);
 * thread replies use rel_type `m.thread` and embed the same marker for the
 * quoted message, so both shapes resolve. Some bridges emit the legacy
 * `rel_type: "m.in_reply_to"` variant with a top-level event id.
 */
function quotedEventIdOf(content: Record<string, unknown>): string | undefined {
  const relatesTo = content["m.relates_to"];
  if (!relatesTo || typeof relatesTo !== "object") return undefined;

  const inReplyTo = (relatesTo as Record<string, unknown>)["m.in_reply_to"];
  if (inReplyTo && typeof inReplyTo === "object") {
    const eventId = (inReplyTo as { event_id?: unknown }).event_id;
    if (typeof eventId === "string" && eventId) return eventId;
  }

  const relation = relatesTo as { rel_type?: unknown; event_id?: unknown };
  if (relation.rel_type === "m.in_reply_to" && typeof relation.event_id === "string") {
    return relation.event_id;
  }
  return undefined;
}

export function parseChatCommand(text: string): { command: string; args: string } | null {
  const match = text.trim().match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) return null;
  return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}


