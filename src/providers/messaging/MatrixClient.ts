import { ConfigurationError, ProviderError } from "../../core/errors.ts";
import { requestJson } from "../../infra/http/request.ts";

export interface MatrixClientOptions {
  homeserverUrl?: string;
  /** Static access token. Takes precedence over username/password. */
  accessToken?: string;
  /** Alternative to a static token: log in with matrix user + password. */
  username?: string;
  password?: string;
}

interface LoginResponse {
  access_token: string;
  user_id: string;
  device_id?: string;
}

export interface MatrixRequestOptions {
  headers?: Record<string, string>;
  body?: RequestInit["body"];
  signal?: AbortSignal;
}

/**
 * Minimal Matrix client: token resolution (static token or m.login.password),
 * authenticated requests with a single re-login retry on 401, message sending
 * and a pre-flight verification (identity + room membership).
 */
export class MatrixClient {
  readonly name = "matrix";
  private cachedToken: string | null = null;
  private userId: string | null = null;

  constructor(private readonly options: MatrixClientOptions) {}

  get configured(): boolean {
    return Boolean(
      this.options.homeserverUrl &&
        (this.options.accessToken || (this.options.username && this.options.password)),
    );
  }

  /** Homeserver base URL without trailing slashes. */
  get homeserver(): string {
    return (this.options.homeserverUrl ?? "").trim().replace(/\/+$/, "");
  }

  async request<T>(
    method: string,
    path: string,
    options: MatrixRequestOptions = {},
  ): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.homeserver}${path}`;
    const token = await this.accessToken();

    try {
      return await requestJson<T>(this.name, url, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...options.headers },
        body: options.body,
        signal: options.signal,
      });
    } catch (error) {
      const canRelogin = !this.options.accessToken && Boolean(this.options.username);
      if (error instanceof ProviderError && error.status === 401 && canRelogin) {
        this.cachedToken = null;
        const fresh = await this.accessToken();
        return requestJson<T>(this.name, url, {
          method,
          headers: { Authorization: `Bearer ${fresh}`, ...options.headers },
          body: options.body,
          signal: options.signal,
        });
      }
      throw error;
    }
  }

  async sendMessage(
    roomId: string,
    eventType: string,
    content: Record<string, unknown>,
  ): Promise<string> {
    const txnId = crypto.randomUUID();
    const response = await this.request<{ event_id: string }>(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(eventType)}/${txnId}`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      },
    );
    return response.event_id;
  }

  /** Resolves credentials (logging in if needed) and returns the user id. */
  async ensureUserId(): Promise<string> {
    if (this.userId) return this.userId;
    const who = await this.request<{ user_id?: string }>("GET", "/_matrix/client/v3/account/whoami");
    if (!who.user_id) {
      throw new ProviderError(this.name, "whoami did not return a user id");
    }
    this.userId = who.user_id;
    return this.userId;
  }

  /**
   * Active pre-flight: resolves credentials, confirms the account identity and
   * its membership in the target room.
   */
  async verify(roomId: string): Promise<string> {
    this.assertConfigured(roomId);
    const who = await this.ensureUserId();

    const member = await this.request<{ membership?: string }>(
      "GET",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(who)}`,
    );
    if (member.membership !== "join") {
      throw new ProviderError(
        this.name,
        `${who} is not joined to ${roomId} (membership: ${member.membership ?? "unknown"})`,
      );
    }

    return `${who} joined ${roomId}`;
  }

  /**
   * Resolves the bot's direct-message room with `userId`: a joined room from
   * the `m.direct` account data is reused, otherwise a private DM room is
   * created (the bot joins as its creator and invites the user) and recorded
   * in `m.direct` so later deliveries find it again.
   */
  async ensureDirectRoom(userId: string): Promise<string> {
    const target = normalizeMatrixUserId(userId);
    this.assertConfigured();

    const me = await this.ensureUserId();
    const direct = await this.directRooms(me);
    for (const roomId of direct[target] ?? []) {
      if (await this.isJoined(roomId, me)) return roomId;
    }

    const created = await this.request<{ room_id?: string }>(
      "POST",
      "/_matrix/client/v3/createRoom",
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: "trusted_private_chat",
          is_direct: true,
          invite: [target],
        }),
      },
    );
    if (!created.room_id) {
      throw new ProviderError(this.name, "createRoom did not return a room id");
    }

    // Remembering the DM is best effort: if the account data write fails the
    // delivery still works, later runs just create the room again.
    try {
      await this.saveDirectRoom(me, direct, target, created.room_id);
    } catch {
      // ignored
    }
    return created.room_id;
  }

  private async directRooms(me: string): Promise<Record<string, string[]>> {
    let data: Record<string, unknown> = {};
    try {
      data = await this.request<Record<string, unknown>>(
        "GET",
        `/_matrix/client/v3/user/${encodeURIComponent(me)}/account_data/m.direct`,
      );
    } catch (error) {
      if (error instanceof ProviderError && error.status === 404) return {};
      throw error;
    }

    const rooms: Record<string, string[]> = {};
    for (const [userId, value] of Object.entries(data)) {
      if (Array.isArray(value)) {
        rooms[userId] = value.filter((entry): entry is string => typeof entry === "string");
      }
    }
    return rooms;
  }

  private async saveDirectRoom(
    me: string,
    rooms: Record<string, string[]>,
    userId: string,
    roomId: string,
  ): Promise<void> {
    const next = { ...rooms, [userId]: [...(rooms[userId] ?? []), roomId] };
    await this.request(
      "PUT",
      `/_matrix/client/v3/user/${encodeURIComponent(me)}/account_data/m.direct`,
      {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      },
    );
  }

  private async isJoined(roomId: string, userId: string): Promise<boolean> {
    try {
      const member = await this.request<{ membership?: string }>(
        "GET",
        `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
      );
      return member.membership === "join";
    } catch (error) {
      if (error instanceof ProviderError && (error.status === 403 || error.status === 404)) {
        return false;
      }
      throw error;
    }
  }

  assertConfigured(roomId?: string): void {
    if (!this.homeserver) {
      throw new ConfigurationError("Matrix is not configured. Set MATRIX_HOMESERVER_URL.");
    }
    if (roomId !== undefined && !roomId) {
      throw new ConfigurationError("Matrix room is not configured. Set MATRIX_ROOM_ID.");
    }
    if (!this.options.accessToken && !(this.options.username && this.options.password)) {
      throw new ConfigurationError(
        "Matrix credentials missing. Set MATRIX_ACCESS_TOKEN, or MATRIX_USERNAME + MATRIX_PASSWORD.",
      );
    }
  }

  private async accessToken(): Promise<string> {
    if (this.options.accessToken) return this.options.accessToken;
    if (this.cachedToken) return this.cachedToken;

    const { username, password } = this.options;
    const homeserverUrl = this.homeserver;
    if (!homeserverUrl || !username || !password) {
      throw new ConfigurationError(
        "Matrix credentials missing. Set MATRIX_ACCESS_TOKEN, or MATRIX_USERNAME + MATRIX_PASSWORD.",
      );
    }

    try {
      const response = await requestJson<LoginResponse>(
        this.name,
        `${homeserverUrl}/_matrix/client/v3/login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "m.login.password",
            identifier: { type: "m.id.user", user: username.trim() },
            password,
            initial_device_display_name: "briefing-engine",
          }),
        },
      );
      this.cachedToken = response.access_token;
      this.userId = response.user_id;
      return response.access_token;
    } catch (error) {
      if (error instanceof ProviderError && error.status === 403) {
        const serverError = extractMatrixError(error);
        throw new ConfigurationError(
          `Matrix login failed${serverError ? ` (${serverError})` : ""}. ` +
            "Check MATRIX_USERNAME and MATRIX_PASSWORD, or use MATRIX_ACCESS_TOKEN. " +
            'Hint: in .env, "$" must be escaped as "\\$" and values containing "#" must be quoted, ' +
            "otherwise the .env parser alters the password.",
          { status: 403 },
        );
      }
      throw error;
    }
  }
}

const MATRIX_USER_ID_PATTERN = /^@[^:\s]+:[^\s]+$/;

/** Accepts "@user:server" (or "user:server") and rejects anything else. */
export function normalizeMatrixUserId(value: string): string {
  const trimmed = value.trim();
  const withSigil = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  if (!MATRIX_USER_ID_PATTERN.test(withSigil)) {
    throw new ConfigurationError(
      `Matrix user id "${value}" is not valid; use the @user:server form`,
    );
  }
  return withSigil;
}

/**
 * Pulls the matrix error (`errcode`/`error`) out of a provider error body so
 * login failures say *why* (invalid password, auth disabled, …).
 */
function extractMatrixError(error: ProviderError): string | undefined {
  const body = error.details?.body;
  if (typeof body !== "string" || !body.trim()) return undefined;
  try {
    const parsed = JSON.parse(body) as { errcode?: string; error?: string };
    if (parsed.errcode && parsed.error) return `${parsed.errcode}: ${parsed.error}`;
    if (parsed.error) return parsed.error;
  } catch {
    // fall through
  }
  return body.slice(0, 200);
}
