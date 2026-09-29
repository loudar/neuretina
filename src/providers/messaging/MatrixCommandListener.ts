import { errorMessage, ProviderError } from "../../core/errors.ts";
import type { EventBus } from "../../core/events/EventBus.ts";
import type { Logger } from "../../core/logger.ts";
import type { KeyValueRepository } from "../../domain/kv/KeyValueRepository.ts";
import type { ChatCommand, ChatCommandSource } from "../../capabilities/chat/ChatChannel.ts";
import type { MatrixClient } from "./MatrixClient.ts";

export interface QuestionInput {
  question: string;
  sender: string;
  channel: string;
  /** Event id of the bot message being quoted. */
  quotedEventId: string;
}

export interface MatrixCommandListenerOptions {
  client: MatrixClient;
  kv: KeyValueRepository;
  bus: EventBus;
  logger: Logger;
  roomId?: string;
  /** If set, only these matrix user ids may issue commands. */
  allowedSenders?: string[];
  /** Handles a parsed command and returns the reply text. */
  onCommand: (command: ChatCommand) => Promise<string>;
  /** Handles a follow-up question (reply quoting one of the bot's messages). */
  onQuestion?: (input: QuestionInput) => Promise<string>;
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
const FILTER = JSON.stringify({
  room: { timeline: { limit: 20, types: ["m.room.message"] } },
});

/**
 * Long-polls the Matrix /sync endpoint for text messages in the configured
 * room and turns `/command args` messages into ChatCommands. The sync position
 * is persisted, so restarts do not replay history and do not execute old
 * commands.
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

        await sleep(RETRY_DELAY_MS);
      }

      // Guard against tight loops if a server answers syncs instantly.
      const elapsed = Date.now() - startedAt;
      if (this.running && elapsed < MIN_SYNC_INTERVAL_MS) {
        await sleep(MIN_SYNC_INTERVAL_MS - elapsed);
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

      // A reply that quotes one of our own messages is a follow-up question.
      if (quotedId && this.isOwnMessage(quotedId)) {
        await this.handleQuestion(body, event, quotedId);
        continue;
      }

      // Commands are plain messages (not replies).
      const parsed = quotedId ? null : parseChatCommand(body);
      if (!parsed) continue;

      const command: ChatCommand = {
        channel: roomId!,
        sender: event.sender,
        command: parsed.command,
        args: parsed.args,
        raw: body.trim(),
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
  }

  private async handleQuestion(
    question: string,
    event: MatrixEvent,
    quotedId: string,
  ): Promise<void> {
    const { roomId, client, bus, logger, onQuestion } = this.options;
    if (!onQuestion) return;

    const trimmed = question.trim();
    if (!trimmed) return;

    const sender = event.sender!;
    const channel = roomId!;

    bus.publish(
      "chat.question.received",
      { channel, sender, question: trimmed.slice(0, 500) },
      { source: "matrix" },
    );

    try {
      const answer = await onQuestion({ question: trimmed, sender, channel, quotedEventId: quotedId });
      this.trackOwnMessage(
        await client.sendMessage(channel, "m.room.message", {
          msgtype: "m.text",
          body: answer,
          "m.relates_to": { "m.in_reply_to": { event_id: event.event_id! } },
        }),
      );
      bus.publish(
        "chat.question.answered",
        { channel, sender, question: trimmed.slice(0, 300), answer: answer.slice(0, 300) },
        { source: "matrix" },
      );
    } catch (error) {
      const message = errorMessage(error);
      bus.publish(
        "chat.question.failed",
        { channel, sender, question: trimmed.slice(0, 300), error: message },
        { source: "matrix" },
      );
      logger.error("question failed", { error: message });
      await client
        .sendMessage(channel, "m.room.message", {
          msgtype: "m.text",
          body: `Sorry, I couldn't answer that: ${message}`,
          "m.relates_to": { "m.in_reply_to": { event_id: event.event_id! } },
        })
        .catch(() => undefined);
    }
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

function quotedEventIdOf(content: Record<string, unknown>): string | undefined {
  const relatesTo = content["m.relates_to"];
  if (!relatesTo || typeof relatesTo !== "object") return undefined;
  const relation = relatesTo as { rel_type?: unknown; event_id?: unknown };
  if (relation.rel_type !== "m.in_reply_to") return undefined;
  return typeof relation.event_id === "string" ? relation.event_id : undefined;
}

export function parseChatCommand(text: string): { command: string; args: string } | null {
  const match = text.trim().match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) return null;
  return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
