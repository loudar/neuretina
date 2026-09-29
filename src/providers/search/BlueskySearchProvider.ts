import { ProviderError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";
import type {
  SearchProvider,
  SearchQuery,
  SearchResponse,
  SearchResult,
} from "../../capabilities/search/SearchProvider.ts";

interface CreateSessionResponse {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
}

interface SearchPostsResponse {
  posts: Array<{
    uri: string;
    cid: string;
    author: { did: string; handle: string; displayName?: string };
    record: { text?: string; createdAt?: string };
    likeCount?: number;
    repostCount?: number;
    replyCount?: number;
    indexedAt?: string;
  }>;
  cursor?: string;
}

export interface BlueskySearchOptions {
  identifier?: string;
  appPassword?: string;
  pdsUrl?: string;
  publicUrl: string;
  defaultLimit?: number;
}

interface Session {
  accessJwt: string;
  refreshJwt: string;
  expiresAt: number;
}

const SESSION_TTL_MS = 90 * 60 * 1000;

export class BlueskySearchProvider implements SearchProvider {
  readonly name = "bluesky";
  readonly kind = "social" as const;

  private session: Session | null = null;
  private resolvedPds: string | null = null;

  constructor(private readonly options: BlueskySearchOptions) {}

  get authenticated(): boolean {
    return Boolean(this.options.identifier && this.options.appPassword);
  }

  async search(query: SearchQuery): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query.query,
      limit: String(Math.min(query.limit ?? this.options.defaultLimit ?? 25, 100)),
      sort: query.sort === "relevance" ? "top" : "latest",
    });

    if (query.language) params.set("lang", query.language);
    const since = recencyToSince(query.recency);
    if (since) params.set("since", since);

    const response = await this.callSearchPosts(params);
    const results: SearchResult[] = response.posts
      .filter((post) => post.record.text && post.record.text.trim().length > 0)
      .map((post) => this.toSearchResult(post));

    return { query: query.query, provider: this.name, kind: this.kind, results };
  }

  private async callSearchPosts(params: URLSearchParams): Promise<SearchPostsResponse> {
    if (!this.authenticated) {
      return this.searchOnHost(this.options.publicUrl, params, false);
    }

    const session = await this.ensureSession();
    const pds = await this.resolvePds();
    try {
      return await this.searchOnHost(pds, params, true, session.accessJwt);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 401) {
        this.session = null;
        const refreshed = await this.ensureSession();
        return this.searchOnHost(pds, params, true, refreshed.accessJwt);
      }
      throw error;
    }
  }

  private async searchOnHost(
    host: string,
    params: URLSearchParams,
    authenticated: boolean,
    token?: string,
  ): Promise<SearchPostsResponse> {
    const url = `${host}/xrpc/app.bsky.feed.searchPosts?${params.toString()}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authenticated && token) headers.Authorization = `Bearer ${token}`;

    try {
      return await requestJson<SearchPostsResponse>(this.name, url, { headers });
    } catch (error) {
      if (error instanceof ProviderError && error.status === 403 && !authenticated) {
        throw new ProviderError(
          this.name,
          "The public Bluesky AppView is currently rejecting unauthenticated search (HTTP 403). " +
            "Set BLUESKY_IDENTIFIER and BLUESKY_APP_PASSWORD to authenticate through your PDS.",
          { status: 403, cause: error },
        );
      }
      throw error;
    }
  }

  private async ensureSession(): Promise<Session> {
    if (this.session && Date.now() < this.session.expiresAt - 60_000) {
      return this.session;
    }

    const base = await this.resolvePds();
    if (this.session?.refreshJwt) {
      try {
        const refreshed = await this.requestSession(`${base}/xrpc/com.atproto.server.refreshSession`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.session.refreshJwt}` },
        });
        this.session = toSession(refreshed);
        return this.session;
      } catch {
        this.session = null;
      }
    }

    const created = await this.requestSession(`${base}/xrpc/com.atproto.server.createSession`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: this.options.identifier,
        password: this.options.appPassword,
      }),
    });
    this.session = toSession(created);
    return this.session;
  }

  /**
   * Resolves the PDS base URL. An explicit BLUESKY_PDS_URL wins; otherwise the
   * PDS is discovered from the account's DID document, so the bsky.social
   * entryway and sharded hosts (*.host.bsky.network) both work with zero
   * configuration.
   */
  private async resolvePds(): Promise<string> {
    if (this.options.pdsUrl) return trimTrailingSlash(this.options.pdsUrl);
    if (this.resolvedPds) return this.resolvedPds;

    try {
      const identifier = this.options.identifier ?? "";
      const did = identifier.startsWith("did:")
        ? identifier
        : await this.resolveHandle(identifier);
      this.resolvedPds = trimTrailingSlash(await this.fetchPdsEndpoint(did));
    } catch {
      this.resolvedPds = "https://bsky.social";
    }

    return this.resolvedPds;
  }

  private async resolveHandle(handle: string): Promise<string> {
    const response = await requestJson<{ did?: string }>(
      this.name,
      `${this.options.publicUrl}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    );
    if (!response.did) {
      throw new ProviderError(this.name, `Could not resolve handle "${handle}" to a DID`);
    }
    return response.did;
  }

  private async fetchPdsEndpoint(did: string): Promise<string> {
    const url = did.startsWith("did:web:")
      ? `https://${did.slice("did:web:".length).replace(/:/g, "/")}/.well-known/did.json`
      : `https://plc.directory/${did}`;

    const document = await requestJson<{
      service?: Array<{ id?: string; type?: string; serviceEndpoint?: string }>;
    }>(this.name, url);

    const service = (document.service ?? []).find(
      (entry) => entry.type === "AtprotoPersonalDataServer" || entry.id === "#atproto_pds",
    );
    if (!service?.serviceEndpoint) {
      throw new ProviderError(this.name, `DID document for ${did} has no atproto PDS service`);
    }
    return service.serviceEndpoint;
  }

  private async requestSession(url: string, init: RequestInit): Promise<CreateSessionResponse> {
    return requestJson<CreateSessionResponse>(this.name, url, { ...init, method: "POST" });
  }

  private toSearchResult(post: SearchPostsResponse["posts"][number]): SearchResult {
    const rkey = post.uri.split("/").pop() ?? "";
    const handle = post.author.handle;
    const engagement: Record<string, number> = {};
    if (post.likeCount !== undefined) engagement.likes = post.likeCount;
    if (post.repostCount !== undefined) engagement.reposts = post.repostCount;
    if (post.replyCount !== undefined) engagement.replies = post.replyCount;

    return {
      title: `${post.author.displayName ?? `@${handle}`} (@${handle})`,
      url: `https://bsky.app/profile/${handle}/post/${rkey}`,
      snippet: (post.record.text ?? "").slice(0, 500),
      publishedAt: post.record.createdAt ?? post.indexedAt,
      source: "bsky.app",
      meta: { author: handle, engagement, uri: post.uri },
    };
  }
}

function toSession(response: CreateSessionResponse): Session {
  return {
    accessJwt: response.accessJwt,
    refreshJwt: response.refreshJwt,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

function recencyToSince(recency: SearchQuery["recency"]): string | undefined {
  if (!recency) return undefined;
  const windows: Record<NonNullable<SearchQuery["recency"]>, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    year: 365 * 24 * 60 * 60 * 1000,
  };
  return new Date(Date.now() - windows[recency]).toISOString();
}

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
