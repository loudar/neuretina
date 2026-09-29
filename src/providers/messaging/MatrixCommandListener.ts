import { errorMessage, ProviderError } from "../../core/errors.ts";
import type { EventBus } from "../../core/events/EventBus.ts";
import type { Logger } from "../../core/logger.ts";
import type { KeyValueRepository } from "../../domain/kv/KeyValueRepository.ts";
import type { ChatCommand, ChatCommandSource } from "../../capabilities/chat/ChatChannel.ts";
import type { MatrixClient } from "./MatrixClient.ts";

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

  constructor(private readonly options: MatrixCommandListenerOptions) {}

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

      if (this.options.allowedSenders?.length && !this.options.allowedSenders.includes(event.sender)) {
        logger.warn("ignoring command from non-allowed sender", { sender: event.sender });
        continue;
      }

      const content = event.content ?? {};
      if (content.msgtype !== "m.text" || typeof content.body !== "string") continue;

      const parsed = parseChatCommand(content.body);
      if (!parsed) continue;

      const command: ChatCommand = {
        channel: roomId!,
        sender: event.sender,
        command: parsed.command,
        args: parsed.args,
        raw: content.body.trim(),
      };

      bus.publish(
        "chat.command.received",
        { channel: command.channel, sender: command.sender, command: command.command, args: command.args },
        { source: "matrix" },
      );

      try {
        const reply = await this.options.onCommand(command);
        await client.sendMessage(command.channel, "m.room.message", {
          msgtype: "m.text",
          body: reply,
        });
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
}

export function parseChatCommand(text: string): { command: string; args: string } | null {
  const match = text.trim().match(/^\/([a-zA-Z0-9_-]+)(?:\s+([\s\S]*))?$/);
  if (!match?.[1]) return null;
  return { command: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
