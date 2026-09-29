import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { BlueskySearchProvider } from "../src/providers/search/BlueskySearchProvider.ts";

const fetchSpy = spyOn(globalThis, "fetch");

function mockFetch(
  implementation: (input: string | URL | Request, init?: RequestInit) => Promise<Response>,
): void {
  fetchSpy.mockImplementation(implementation as unknown as typeof fetch);
}

afterEach(() => {
  fetchSpy.mockReset();
});

const post = {
  uri: "at://did:plc:abc/app.bsky.feed.post/rkey1",
  cid: "cid1",
  author: { did: "did:plc:abc", handle: "alice.bsky.social", displayName: "Alice" },
  record: { text: "Local-first is the future", createdAt: "2026-09-28T10:00:00.000Z" },
  likeCount: 12,
  repostCount: 3,
  replyCount: 1,
};

describe("BlueskySearchProvider", () => {
  test("searches the public AppView when no credentials are configured", async () => {
    let calledUrl = "";
    mockFetch(async (input) => {
      calledUrl = String(input);
      return Response.json({ posts: [post] });
    });

    const provider = new BlueskySearchProvider({
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    const response = await provider.search({ query: "local-first", limit: 5, recency: "day" });

    expect(calledUrl).toContain("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts");
    expect(calledUrl).toContain("q=local-first");
    expect(calledUrl).toContain("sort=latest");
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.url).toBe("https://bsky.app/profile/alice.bsky.social/post/rkey1");
    expect(response.results[0]?.source).toBe("bsky.app");
    expect(response.results[0]?.meta?.engagement).toEqual({ likes: 12, reposts: 3, replies: 1 });
  });

  test("explains the 403 when public search is blocked", async () => {
    mockFetch(async () => new Response("forbidden", { status: 403 }));

    const provider = new BlueskySearchProvider({
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    await expect(provider.search({ query: "x" })).rejects.toThrow(/BLUESKY_IDENTIFIER/);
  });

  test("creates a session and searches through the user's PDS when configured", async () => {
    const calls: Array<{ url: string; auth?: string }> = [];
    mockFetch(async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      calls.push({ url, auth: headers.get("authorization") ?? undefined });

      if (url.endsWith("/xrpc/com.atproto.server.createSession")) {
        return Response.json({ accessJwt: "jwt-1", refreshJwt: "refresh-1", handle: "bot.test", did: "did:plc:bot" });
      }
      if (url.includes("/xrpc/app.bsky.feed.searchPosts")) {
        return Response.json({ posts: [post] });
      }
      return new Response("not found", { status: 404 });
    });

    const provider = new BlueskySearchProvider({
      identifier: "bot.test",
      appPassword: "app-password",
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    const response = await provider.search({ query: "ai" });

    expect(calls[0]?.url).toContain("createSession");
    expect(calls[1]?.url).toContain("https://bsky.social/xrpc/app.bsky.feed.searchPosts");
    expect(calls[1]?.auth).toBe("Bearer jwt-1");
    expect(response.results).toHaveLength(1);
  });

  test("refreshes the session once on 401 and retries", async () => {
    let searchAttempts = 0;
    mockFetch(async (input) => {
      const url = String(input);
      if (url.endsWith("/xrpc/com.atproto.server.createSession")) {
        return Response.json({ accessJwt: "jwt-old", refreshJwt: "refresh-1", handle: "b", did: "d" });
      }
      if (url.includes("refreshSession")) {
        return Response.json({ accessJwt: "jwt-new", refreshJwt: "refresh-2", handle: "b", did: "d" });
      }
      if (url.includes("searchPosts")) {
        searchAttempts += 1;
        if (searchAttempts === 1) return new Response("expired", { status: 401 });
        return Response.json({ posts: [post] });
      }
      return new Response("not found", { status: 404 });
    });

    const provider = new BlueskySearchProvider({
      identifier: "b",
      appPassword: "p",
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    const response = await provider.search({ query: "x" });
    expect(searchAttempts).toBe(2);
    expect(response.results).toHaveLength(1);
  });

  test("discovers the PDS from the account's DID document when no pdsUrl is set", async () => {
    const calls: string[] = [];
    mockFetch(async (input) => {
      const url = String(input);
      calls.push(url);

      if (url.includes("/xrpc/com.atproto.identity.resolveHandle")) {
        return Response.json({ did: "did:plc:abc" });
      }
      if (url === "https://plc.directory/did:plc:abc") {
        return Response.json({
          service: [
            {
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://auriporia.us-west.host.bsky.network",
            },
          ],
        });
      }
      if (url.endsWith("/xrpc/com.atproto.server.createSession")) {
        return Response.json({ accessJwt: "jwt", refreshJwt: "r", handle: "b", did: "did:plc:abc" });
      }
      if (url.includes("searchPosts")) {
        return Response.json({ posts: [post] });
      }
      return new Response("not found", { status: 404 });
    });

    const provider = new BlueskySearchProvider({
      identifier: "bot.test",
      appPassword: "pw",
      publicUrl: "https://public.api.bsky.app",
    });

    const response = await provider.search({ query: "x" });

    expect(calls[0]).toContain("resolveHandle");
    expect(calls).toContain("https://plc.directory/did:plc:abc");
    expect(
      calls.some((url) =>
        url.startsWith("https://auriporia.us-west.host.bsky.network/xrpc/com.atproto.server.createSession"),
      ),
    ).toBe(true);
    expect(
      calls.some((url) =>
        url.startsWith("https://auriporia.us-west.host.bsky.network/xrpc/app.bsky.feed.searchPosts"),
      ),
    ).toBe(true);
    expect(response.results).toHaveLength(1);
  });
});
