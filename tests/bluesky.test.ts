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

  test("extracts image and video media from post embeds", async () => {
    const imagePost = {
      ...post,
      uri: "at://did:plc:abc/app.bsky.feed.post/rkey2",
      embed: {
        $type: "app.bsky.embed.images#view",
        images: [
          {
            thumb: "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/bafk1@jpeg",
            fullsize: "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafk1@jpeg",
            alt: "a chart",
            aspectRatio: { width: 1200, height: 675 },
          },
        ],
      },
    };
    const videoPost = {
      ...post,
      uri: "at://did:plc:abc/app.bsky.feed.post/rkey3",
      record: { text: "watch this", createdAt: "2026-09-28T10:00:00.000Z" },
      embed: {
        $type: "app.bsky.embed.recordWithMedia#view",
        media: {
          $type: "app.bsky.embed.video#view",
          thumbnail: "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/vid@jpeg",
          aspectRatio: { width: 1080, height: 1920 },
        },
      },
    };

    mockFetch(async () => Response.json({ posts: [imagePost, videoPost] }));

    const provider = new BlueskySearchProvider({
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    const response = await provider.search({ query: "x" });

    expect(response.results[0]?.media).toEqual([
      {
        type: "image",
        thumbUrl: "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/bafk1@jpeg",
        fullUrl: "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:abc/bafk1@jpeg",
        alt: "a chart",
        width: 1200,
        height: 675,
      },
    ]);
    expect(response.results[1]?.media).toEqual([
      {
        type: "video",
        thumbUrl: "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/vid@jpeg",
        fullUrl: "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:abc/vid@jpeg",
        width: 1080,
        height: 1920,
      },
    ]);
  });

  test("retries transient PDS failures and falls back to the public AppView", async () => {
    const calls: string[] = [];
    mockFetch(async (input) => {
      const url = String(input);
      calls.push(url);

      if (url.endsWith("/xrpc/com.atproto.server.createSession")) {
        return Response.json({ accessJwt: "jwt", refreshJwt: "r", handle: "b", did: "d" });
      }
      if (url.startsWith("https://bsky.social/xrpc/app.bsky.feed.searchPosts")) {
        return new Response("upstream failure", { status: 502 });
      }
      if (url.startsWith("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts")) {
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

    expect(response.results).toHaveLength(1);
    // One attempt plus two retries on the PDS, then the AppView fallback.
    expect(
      calls.filter((url) => url.startsWith("https://bsky.social/xrpc/app.bsky.feed.searchPosts")),
    ).toHaveLength(3);
    expect(
      calls.some((url) =>
        url.startsWith("https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts"),
      ),
    ).toBe(true);
  });

  test("maps 3days to a three-day window and passes the language", async () => {
    let calledUrl = "";
    mockFetch(async (input) => {
      calledUrl = String(input);
      return Response.json({ posts: [post] });
    });

    const provider = new BlueskySearchProvider({
      pdsUrl: "https://bsky.social",
      publicUrl: "https://public.api.bsky.app",
    });

    await provider.search({ query: "x", recency: "3days", language: "en" });

    const params = new URL(calledUrl).searchParams;
    const ageMs = Date.now() - new Date(params.get("since") ?? 0).getTime();
    expect(ageMs).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
    expect(ageMs).toBeLessThan(3.1 * 24 * 60 * 60 * 1000);
    expect(params.get("lang")).toBe("en");
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
