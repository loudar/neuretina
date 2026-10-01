import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AuthService } from "../src/auth/AuthService.ts";
import { RateLimiter } from "../src/auth/RateLimiter.ts";
import { createLogger } from "../src/core/logger.ts";
import { createKernel, type Kernel } from "../src/kernel/Kernel.ts";
import { StubTts, completion, stubLlm, stubSearch, testConfig } from "./support.ts";

describe("AuthService", () => {
  test("issues a session for the right password, not the wrong one", () => {
    const auth = new AuthService({ config: testConfig({ AUTH_GLOBAL_PASSWORD: "hunter2" }) });
    expect(auth.enabled).toBe(true);
    expect(auth.methods()).toEqual([{ id: "password", title: "Password" }]);
    expect(auth.status(undefined)).toMatchObject({ required: true, authenticated: false });

    expect(auth.login("password", { password: "wrong" })).toBeNull();
    const result = auth.login("password", { password: "hunter2" });
    expect(result).not.toBeNull();

    const session = auth.verify(result!.token);
    expect(session?.subject).toBe("admin");
    expect(session?.method).toBe("password");
    expect(auth.status(result!.token).authenticated).toBe(true);
  });

  test("logs the shared password in as ADMIN_USERNAME", () => {
    const auth = new AuthService({
      config: testConfig({ AUTH_GLOBAL_PASSWORD: "pw", ADMIN_USERNAME: "boss" }),
    });
    const result = auth.login(undefined, { password: "pw" });
    expect(auth.verify(result!.token)?.subject).toBe("boss");
  });

  test("rejects tampered, malformed and expired tokens", () => {
    const config = testConfig({ AUTH_GLOBAL_PASSWORD: "hunter2", AUTH_SESSION_TTL_HOURS: "2" });
    const auth = new AuthService({ config });
    const token = auth.login(undefined, { password: "hunter2" })!.token;
    const [payload] = token.split(".");

    expect(auth.verify(`${payload}.AAAA`)).toBeNull();
    expect(auth.verify("not-a-token")).toBeNull();
    expect(auth.verify(undefined)).toBeNull();

    const later = new AuthService({ config, now: () => Date.now() + 3 * 60 * 60 * 1000 });
    expect(later.verify(token)).toBeNull();
  });

  test("needs no login while no mechanism is configured", () => {
    const auth = new AuthService({ config: testConfig() });
    expect(auth.enabled).toBe(false);
    expect(auth.status(undefined)).toEqual({ required: false, authenticated: true, methods: [] });
    expect(auth.login(undefined, { password: "anything" })).toBeNull();
  });

  test("changing the password invalidates existing sessions", () => {
    const config = testConfig({ AUTH_GLOBAL_PASSWORD: "first" });
    const auth = new AuthService({ config });
    const token = auth.login(undefined, { password: "first" })!.token;
    expect(auth.verify(token)).not.toBeNull();

    config.auth.globalPassword = "second";
    expect(auth.verify(token)).toBeNull();
  });

  test("keeps sessions across password changes with an explicit session secret", () => {
    const config = testConfig({
      AUTH_GLOBAL_PASSWORD: "first",
      AUTH_SESSION_SECRET: "stable-signing-key",
    });
    const auth = new AuthService({ config });
    const token = auth.login(undefined, { password: "first" })!.token;

    config.auth.globalPassword = "second";
    expect(auth.verify(token)).not.toBeNull();
  });

  test("throttles repeated failures per client key", () => {
    const auth = new AuthService({ config: testConfig({ AUTH_GLOBAL_PASSWORD: "pw" }) });
    for (let attempt = 0; attempt < 10; attempt += 1) auth.recordFailure("1.2.3.4");
    expect(auth.blocked("1.2.3.4")).toBe(true);
    expect(auth.blocked("5.6.7.8")).toBe(false);
    auth.clearFailures("1.2.3.4");
    expect(auth.blocked("1.2.3.4")).toBe(false);
  });
});

describe("RateLimiter", () => {
  test("allows the limit per key, then blocks until the window slides", () => {
    let now = 1_000_000;
    const limiter = new RateLimiter(5, 60_000, () => now);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.take("1.2.3.4").allowed).toBe(true);
    }

    const blocked = limiter.take("1.2.3.4");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);

    // Other keys have their own window.
    expect(limiter.take("5.6.7.8").allowed).toBe(true);

    now += 60_001;
    expect(limiter.take("1.2.3.4").allowed).toBe(true);
  });
});

describe("password-protected gateway", () => {
  let kernel: Kernel;
  let base: string;

  beforeAll(async () => {
    kernel = await createKernel({
      config: testConfig({ AUTH_GLOBAL_PASSWORD: "hunter2" }),
      logger: createLogger("test", { level: "error" }),
      llm: stubLlm(() => completion("ok")),
      webSearch: stubSearch("perplexity", "web"),
      socialSearch: stubSearch("bluesky", "social"),
      tts: new StubTts(),
    });
    base = `http://127.0.0.1:${kernel.api.port}`;
  });

  afterAll(async () => {
    await kernel.shutdown();
  });

  async function post(path: string, body: unknown, cookie?: string): Promise<Response> {
    return fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test("blocks the API but keeps the probe and status public", async () => {
    const probe = await fetch(`${base}/api/webhook`);
    expect(probe.status).toBe(200);
    expect(((await probe.json()) as { auth: string }).auth).toBe("required");

    const status = (await (await fetch(`${base}/api/auth/status`)).json()) as {
      required: boolean;
      authenticated: boolean;
      methods: Array<{ id: string; title: string }>;
    };
    expect(status.required).toBe(true);
    expect(status.authenticated).toBe(false);
    expect(status.methods).toEqual([{ id: "password", title: "Password" }]);

    const denied = await post("/api/webhook", { type: "topic.list" });
    expect(denied.status).toBe(401);
    expect(((await denied.json()) as { code: string }).code).toBe("UNAUTHORIZED");
  });

  test("logs in with the password and out again", async () => {
    const wrong = await post("/api/auth/login", { password: "nope" });
    expect(wrong.status).toBe(401);

    const login = await post("/api/auth/login", { method: "password", password: "hunter2" });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie");
    expect(setCookie).toContain("neuretina_session=");
    expect(setCookie).toContain("HttpOnly");
    const cookie = setCookie!.split(";")[0]!;

    const status = (await (
      await fetch(`${base}/api/auth/status`, { headers: { cookie } })
    ).json()) as { authenticated: boolean; method?: string };
    expect(status.authenticated).toBe(true);
    expect(status.method).toBe("password");

    const allowed = await post("/api/webhook", { type: "topic.list" }, cookie);
    expect(allowed.status).toBe(200);

    const logout = await post("/api/auth/logout", {}, cookie);
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

describe("login rate limiting", () => {
  let kernel: Kernel;
  let base: string;

  // A dedicated kernel: the limiter is per server and per client address, so
  // the other tests' login calls must not count against this window.
  beforeAll(async () => {
    kernel = await createKernel({
      config: testConfig({ AUTH_GLOBAL_PASSWORD: "hunter2" }),
      logger: createLogger("test", { level: "error" }),
      llm: stubLlm(() => completion("ok")),
      webSearch: stubSearch("perplexity", "web"),
      socialSearch: stubSearch("bluesky", "social"),
      tts: new StubTts(),
    });
    base = `http://127.0.0.1:${kernel.api.port}`;
  });

  afterAll(async () => {
    await kernel.shutdown();
  });

  test("rejects more than 5 login requests per minute from one address", async () => {
    const login = (password: string) =>
      fetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await login("wrong");
      expect(response.status).toBe(401);
    }

    const blocked = await login("wrong");
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBeTruthy();
    expect(((await blocked.json()) as { code: string }).code).toBe("TOO_MANY_REQUESTS");
  });
});
