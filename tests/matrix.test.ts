import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { MatrixMessagingProvider } from "../src/providers/messaging/MatrixMessagingProvider.ts";
import type { OutboundVoiceMessage } from "../src/capabilities/messaging/MessagingProvider.ts";

const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

const voice: OutboundVoiceMessage = {
  kind: "voice",
  audio: new Uint8Array([1, 2, 3, 4]),
  mimeType: "audio/ogg",
  durationMs: 3000,
  filename: "brief.ogg",
  caption: "Morning brief",
};

interface Call {
  url: string;
  method: string;
  auth?: string;
}

function recordingMock(
  handler: (url: string, call: Call, body: unknown) => Response | undefined,
): Call[] {
  const calls: Call[] = [];
  mockFetch(async (input, init) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      auth: new Headers(init?.headers).get("authorization") ?? undefined,
    };
    calls.push(call);
    const response = handler(url, call, init?.body);
    return response ?? new Response("not found", { status: 404 });
  });
  return calls;
}

describe("MatrixMessagingProvider", () => {
  test("logs in with username + password and sends a voice message", async () => {
    const calls = recordingMock((url) => {
      if (url.endsWith("/_matrix/client/v3/login")) {
        return Response.json({ access_token: "tok-1", user_id: "@bot:example.org" });
      }
      if (url.includes("/media/upload")) {
        return Response.json({ content_uri: "mxc://example.org/abc" });
      }
      if (url.includes("/send/m.room.message/")) {
        return Response.json({ event_id: "$evt1" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      username: "bot",
      password: "secret",
      roomId: "!room:example.org",
    });

    const sent = await provider.send(voice);
    expect(sent.id).toBe("$evt1");
    expect(sent.kind).toBe("voice");

    const login = calls[0]!;
    expect(login.url).toBe("https://matrix.example.org/_matrix/client/v3/login");
    expect(login.method).toBe("POST");

    const upload = calls[1]!;
    expect(upload.url).toContain("/_matrix/client/v1/media/upload");
    expect(upload.auth).toBe("Bearer tok-1");

    const send = calls[2]!;
    expect(send.method).toBe("PUT");
    expect(send.auth).toBe("Bearer tok-1");
  });

  test("re-logs in once after a 401", async () => {
    let logins = 0;
    let uploads = 0;

    recordingMock((url) => {
      if (url.endsWith("/_matrix/client/v3/login")) {
        logins += 1;
        return Response.json({ access_token: `tok-${logins}`, user_id: "@bot:example.org" });
      }
      if (url.includes("/media/upload")) {
        uploads += 1;
        if (uploads === 1) return new Response("token expired", { status: 401 });
        return Response.json({ content_uri: "mxc://example.org/abc" });
      }
      if (url.includes("/send/m.room.message/")) {
        return Response.json({ event_id: "$evt2" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      username: "bot",
      password: "secret",
      roomId: "!room:example.org",
    });

    await provider.send(voice);
    expect(logins).toBe(2);
    expect(uploads).toBe(2);
  });

  test("uses a static access token without logging in", async () => {
    const calls = recordingMock((url) => {
      if (url.includes("/media/upload")) {
        return Response.json({ content_uri: "mxc://example.org/abc" });
      }
      if (url.includes("/send/m.room.message/")) {
        return Response.json({ event_id: "$evt3" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "syt_static_token",
      roomId: "!room:example.org",
    });

    await provider.send(voice);
    expect(calls.some((call) => call.url.includes("/login"))).toBe(false);
    expect(calls[0]?.auth).toBe("Bearer syt_static_token");
  });

  test("falls back to the legacy upload endpoint when the authenticated one is missing", async () => {
    const calls = recordingMock((url) => {
      if (url.includes("/_matrix/client/v1/media/upload")) {
        return new Response("unrecognized", { status: 404 });
      }
      if (url.includes("/_matrix/media/v3/upload")) {
        return Response.json({ content_uri: "mxc://example.org/legacy" });
      }
      if (url.includes("/send/m.room.message/")) {
        return Response.json({ event_id: "$evt4" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "tok",
      roomId: "!room:example.org",
    });

    await provider.send(voice);
    expect(calls.some((call) => call.url.includes("/_matrix/media/v3/upload"))).toBe(true);
  });

  test("throws a configuration error when credentials are missing", async () => {
    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      roomId: "!room:example.org",
    });

    await expect(provider.send(voice)).rejects.toThrow(/credentials missing/);
  });

  test("verify() logs in, checks identity and room membership", async () => {
    const calls = recordingMock((url) => {
      if (url.endsWith("/_matrix/client/v3/login")) {
        return Response.json({ access_token: "tok-verify", user_id: "@bot:example.org" });
      }
      if (url.endsWith("/account/whoami")) {
        return Response.json({ user_id: "@bot:example.org" });
      }
      if (url.includes("/state/m.room.member/")) {
        return Response.json({ membership: "join" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      username: "bot",
      password: "secret",
      roomId: "!room:example.org",
    });

    const detail = await provider.verify();

    expect(detail).toContain("@bot:example.org joined !room:example.org");
    expect(calls[0]?.url).toContain("/login");
    expect(calls[1]?.url).toContain("/account/whoami");
    expect(calls[1]?.auth).toBe("Bearer tok-verify");
    expect(decodeURIComponent(calls[2]!.url)).toContain("/rooms/!room:example.org/state/m.room.member/@bot:example.org");
  });

  test("verify() fails when the account is not in the room", async () => {
    recordingMock((url) => {
      if (url.endsWith("/account/whoami")) {
        return Response.json({ user_id: "@bot:example.org" });
      }
      if (url.includes("/state/m.room.member/")) {
        return Response.json({ membership: "leave" });
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      accessToken: "tok",
      roomId: "!room:example.org",
    });

    await expect(provider.verify()).rejects.toThrow(/not joined/);
  });

  test("login failures surface the homeserver's error reason", async () => {
    recordingMock((url) => {
      if (url.endsWith("/_matrix/client/v3/login")) {
        return new Response(
          JSON.stringify({ errcode: "M_FORBIDDEN", error: "Invalid password" }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    const provider = new MatrixMessagingProvider({
      homeserverUrl: "https://matrix.example.org",
      username: "bot",
      password: "wrong",
      roomId: "!room:example.org",
    });

    await expect(provider.verify()).rejects.toThrow(/M_FORBIDDEN: Invalid password/);
  });
});
