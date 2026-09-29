import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
  parseChatCommand,
  stripReplyFallback,
  MatrixCommandListener,
} from "../src/providers/messaging/MatrixCommandListener.ts";
import { MatrixClient } from "../src/providers/messaging/MatrixClient.ts";
import { KeyValueRepository } from "../src/domain/kv/KeyValueRepository.ts";
import { SqliteDatabase } from "../src/infra/db/SqliteDatabase.ts";
import { EventBus } from "../src/core/events/EventBus.ts";
import { EventStore } from "../src/core/events/EventStore.ts";
import { createLogger } from "../src/core/logger.ts";
import type { ChatCommand } from "../src/capabilities/chat/ChatChannel.ts";
import { waitForEvent } from "./support.ts";

const log = createLogger("test", { level: "error" });
const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

describe("parseChatCommand", () => {
  test("parses commands and arguments", () => {
    expect(parseChatCommand("/start morning-brief")).toEqual({
      command: "start",
      args: "morning-brief",
    });
    expect(parseChatCommand("  /Start   a b  ")).toEqual({ command: "start", args: "a b" });
    expect(parseChatCommand("/help")).toEqual({ command: "help", args: "" });
    expect(parseChatCommand("hello")).toBeNull();
    expect(parseChatCommand("/")).toBeNull();
  });
});

interface SentRequest {
  method: string;
  url: string;
  body?: string;
}

function setupListener(options: {
  allowedSenders?: string[];
  onCommand?: (command: ChatCommand) => Promise<string>;
  onQuestion?: (input: { question: string; sender: string; quotedEventId: string }) => Promise<string>;
}) {
  const db = new SqliteDatabase(":memory:");
  const kv = new KeyValueRepository(db);
  const bus = new EventBus(new EventStore(db), log);
  const client = new MatrixClient({
    homeserverUrl: "https://matrix.test",
    accessToken: "tok",
  });

  const received: ChatCommand[] = [];
  const sent: SentRequest[] = [];

  mockFetch(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/account/whoami")) {
      return Response.json({ user_id: "@bot:matrix.test" });
    }
    if (url.includes("/_matrix/client/v3/sync")) {
      const params = new URL(url).searchParams;
      const since = params.get("since");
      if (!since) {
        return Response.json({ next_batch: "s0" });
      }
      if (since === "s0") {
        return Response.json({
          next_batch: "s1",
          rooms: {
            join: {
              "!room:matrix.test": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      sender: "@user:matrix.test",
                      event_id: "$m1",
                      content: { msgtype: "m.text", body: "/start morning-brief" },
                    },
                    {
                      type: "m.room.message",
                      sender: "@bot:matrix.test",
                      event_id: "$m2",
                      content: { msgtype: "m.text", body: "/start self" },
                    },
                    {
                      type: "m.room.message",
                      sender: "@other:matrix.test",
                      event_id: "$m3",
                      content: { msgtype: "m.text", body: "/start from-other" },
                    },
                    {
                      type: "m.room.message",
                      sender: "@user:matrix.test",
                      event_id: "$m4",
                      content: { msgtype: "m.text", body: "not a command" },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      if (since === "s1") {
        return Response.json({
          next_batch: "s2",
          rooms: {
            join: {
              "!room:matrix.test": {
                timeline: {
                  events: [
                    {
                      type: "m.room.message",
                      sender: "@user:matrix.test",
                      event_id: "$m5",
                      content: {
                        msgtype: "m.text",
                        body: "> <@bot:matrix.test> Morning brief\n\nwhat is X?",
                        "m.relates_to": { rel_type: "m.in_reply_to", event_id: "$botmsg" },
                      },
                    },
                    {
                      type: "m.room.message",
                      sender: "@user:matrix.test",
                      event_id: "$m6",
                      content: {
                        msgtype: "m.text",
                        body: "> <@someone:matrix.test> hello\n\nnot for the bot",
                        "m.relates_to": { rel_type: "m.in_reply_to", event_id: "$someone-else" },
                      },
                    },
                  ],
                },
              },
            },
          },
        });
      }
      // Pace the loop like a real long-poll would.
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Response.json({ next_batch: since });
    }
    if (url.includes("/send/m.room.message/")) {
      sent.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
      return Response.json({ event_id: "$evt" });
    }
    return new Response("not found", { status: 404 });
  });

  const questions: Array<{ question: string; sender: string; quotedEventId: string }> = [];
  const listener = new MatrixCommandListener({
    client,
    kv,
    bus,
    logger: log,
    roomId: "!room:matrix.test",
    allowedSenders: options.allowedSenders,
    onCommand:
      options.onCommand ??
      (async (command) => {
        received.push(command);
        return `ack:${command.command}`;
      }),
    onQuestion:
      options.onQuestion ??
      (async (input) => {
        questions.push(input);
        return "Answer text";
      }),
  });

  return { listener, kv, bus, received, sent, questions };
}

describe("MatrixCommandListener", () => {
  test("syncs, ignores own/non-command/other messages and replies to commands", async () => {
    const { listener, kv, bus, received, sent } = setupListener({
      allowedSenders: ["@user:matrix.test"],
    });

    const handled = waitForEvent(bus, "chat.command.handled");
    await listener.start();
    await handled;
    listener.stop();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      command: "start",
      args: "morning-brief",
      sender: "@user:matrix.test",
      channel: "!room:matrix.test",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.method).toBe("PUT");
    expect(sent[0]?.body).toContain("ack:start");

    expect(kv.get("matrix.sync_token")).not.toBeNull();
  });

  test("respects the sender allowlist", async () => {
    const { listener, bus, received } = setupListener({
      allowedSenders: ["@someone-else:matrix.test"],
    });

    const receiverEvents: string[] = [];
    bus.subscribe("chat.*", (event) => receiverEvents.push(event.topic));

    await listener.start();
    await new Promise((resolve) => setTimeout(resolve, 150));
    listener.stop();

    expect(received).toHaveLength(0);
    expect(receiverEvents).toHaveLength(0);
  });

  test("replies with an error when the command handler throws", async () => {
    const { listener, bus, sent } = setupListener({
      allowedSenders: ["@user:matrix.test"],
      onCommand: async () => {
        throw new Error("handler exploded");
      },
    });

    const failed = waitForEvent(bus, "chat.command.failed");
    await listener.start();
    await failed;

    const deadline = Date.now() + 2000;
    while (sent.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    listener.stop();

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toContain("handler exploded");
  });

  test("answers follow-up questions that quote one of the bot's messages", async () => {
    const { listener, bus, sent, questions } = setupListener({});
    // Simulate a message the bot sent earlier (summary text delivery).
    bus.publish(
      "message.text.sent",
      { correlationId: "c-bot", channel: "!room:matrix.test", eventId: "$botmsg" },
      { source: "test" },
    );

    const answered = waitForEvent(bus, "chat.question.answered");
    await listener.start();
    await answered;
    listener.stop();

    // Only the reply quoting *our* message is answered (with the quote
    // fallback stripped); the one quoting someone else is ignored.
    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      question: "what is X?",
      sender: "@user:matrix.test",
      quotedEventId: "$botmsg",
    });

    const reply = sent.find((request) => request.body?.includes("Answer text"));
    expect(reply?.body).toContain('"event_id":"$m5"');
  });
});

describe("stripReplyFallback", () => {
  test("removes the quoted reply lines", () => {
    expect(stripReplyFallback("> <@bot:test> Brief title\n\nwhat is X?")).toBe("what is X?");
    expect(stripReplyFallback("> a\n> b\nplain text")).toBe("plain text");
    expect(stripReplyFallback("no quote here")).toBe("no quote here");
  });
});
