# Briefing Engine

A modular, event-driven TypeScript service that periodically researches topics you care about,
compiles a neutral morning brief, turns it into speech, and delivers it as a voice message.

Built on **Bun** (runtime, SQLite, HTTP server, cron), **TypeScript 7**, **Svelte 5**, and an
event bus that every subsystem publishes to from the ground up.

## How it works

```
scheduler (Bun.cron, jobs in SQLite)
   └─> workflow run ────────────────────────────────────────────────┐
        research agent (LLM tool-calling loop)                      │
          ├─ web_search      → Perplexity Search API                │
          └─ bluesky_search  → AT Protocol app.bsky.feed.searchPosts│
        compiler LLM → neutral markdown brief + spoken narration    │
        ElevenLabs   → speech audio (eleven_v4)                     │
        Matrix       → voice message (MSC3245)                      │
                                                                     ▼
                          every step publishes typed events → EventBus → SQLite event log
                                                                     │
                                            Svelte UI ◄── webhook event.wait (feed long-poll)
```

### Architecture

| Layer | Location | Purpose |
| --- | --- | --- |
| Core | `src/core` | event bus + persisted event store, scheduler, workflow registry, logger, errors |
| Capabilities | `src/capabilities` | provider-agnostic interfaces: `LlmProvider`, `SearchProvider`, `TextToSpeechProvider`, `MessagingProvider` |
| Providers | `src/providers` | concrete integrations (OpenAI-compatible LLM, Perplexity, Bluesky, ElevenLabs, Matrix) |
| Domain | `src/domain` | SQLite repositories: topics, briefs, scheduled jobs |
| Agents | `src/agents` | generic `Agent` tool-calling runtime + `SearchTool` that wraps any `SearchProvider` |
| Workflows | `src/workflows` | `BriefingWorkflow` orchestrating research → compile → TTS → delivery |
| Command handlers | `src/commands` | application message handlers (topics, jobs, briefs, workflows) |
| API | `src/api` | single webhook gateway + static UI (no other endpoints) |
| UI | `web` | Svelte 5 + Vite frontend built on the **M3 Svelte** Material 3 design system |

Adding a provider means implementing one interface and wiring it in `src/kernel/Kernel.ts`.
Adding an agent capability means implementing `Tool` and passing it to an `Agent`.

## Quick start

```bash
bun install
cp .env.example .env        # fill in the keys (see below)
bun run dev                 # API on :8080
bun run dev:web             # Svelte dev server on :5173 (proxies /api)
```

Production-style run:

```bash
bun run build:web
bun run start
```

Quality gates:

```bash
bun run typecheck
bun test
```

## Integrations setup

### OpenCode Go (LLM)

- Subscribe to Go at https://opencode.ai/auth and copy the API key → `OPENCODE_API_KEY`.
- Defaults: `LLM_BASE_URL=https://opencode.ai/zen/go/v1`, `LLM_MODEL=deepseek-v4-flash`
  (OpenAI-compatible `/chat/completions`).

### Perplexity (web search)

- Create an API key → `KEY_PERPLEXITY`.
- The agent calls `POST https://api.perplexity.ai/search` and receives raw ranked results
  (`title`, `url`, `snippet`, `date`) — no LLM answer in the loop.

### ElevenLabs (speech)

- API key → `KEY_ELEVENLABS`.
- `ELEVENLABS_MODEL_ID=eleven_v4` (highest-quality model; `eleven_v4_turbo` also works).
- Pick a voice from the voice library and set `ELEVENLABS_VOICE_ID`.
- `opus_48000_128` is the default output format because Matrix clients render Ogg/Opus as a
  native voice bubble.

### Bluesky / AT Protocol search

What you need:

1. A Bluesky account (a dedicated bot account is fine) and its **handle** → `BLUESKY_IDENTIFIER`.
2. An **app password** for that account → `BLUESKY_APP_PASSWORD`.
   Create it in Bluesky: *Settings → App Passwords → Add App Password* (format `xxxx-xxxx-xxxx-xxxx`).
3. **No PDS URL needed.** Leave `BLUESKY_PDS_URL` empty and the provider auto-discovers the PDS
   from the account's DID document (`plc.directory` / `did:web`). This works whether the account is
   hosted on `bsky.social`, on a shard like `*.host.bsky.network`, or on a third-party PDS. Set it
   explicitly only if you want to pin a specific host.

   To answer the obvious question: `https://bsky.social` is the *entryway* and still works for
   Bluesky-hosted accounts, including shard-hosted ones (`auriporia.us-west.host.bsky.network`) —
   the entryway routes the login to the right shard. Auto-discovery makes the choice irrelevant.

The provider logs in with `com.atproto.server.createSession`, refreshes the session automatically,
and searches via `app.bsky.feed.searchPosts` on your PDS (the officially recommended route for
authenticated reads).

Without credentials it falls back to the public AppView, but Bluesky currently load-sheds
unauthenticated `searchPosts` with `HTTP 403`, so app-password auth is strongly recommended.

### Matrix voice messages

What you need:

1. Homeserver URL → `MATRIX_HOMESERVER_URL` (e.g. `https://matrix.illegal.trading`).
2. Credentials — **either**:
   - `MATRIX_USERNAME` + `MATRIX_PASSWORD`: the simplest option if you don't have a token. The app
     logs in with `m.login.password` on first use and caches the token (re-login on 401).
   - **or** a static **access token** → `MATRIX_ACCESS_TOKEN`. Many newer clients (including Sable)
     no longer show the access token in their settings UI, so the reliable way is the login API:

     ```bash
     curl -X POST https://matrix.illegal.trading/_matrix/client/v3/login \
       -H "Content-Type: application/json" \
       -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"bot"},
            "password":"your-password"}'
     ```

   The response contains `access_token` — use that. (Synapse also accepts an app/user access
   token created via admin tooling.) A static token never expires unless the server expires it.

   **`.env` quoting warning:** Bun expands `$VAR` inside `.env` values **regardless of quoting** —
   a password like `Correct$Horse#1` is silently altered on load ("Invalid identifier or
   password" at login). Write literal `$` as `\$` and quote values containing `#`:

   ```env
   MATRIX_PASSWORD="Correct\$Horse#1"
   ```

   Alternatively, in Coolify set the env var in its UI (passed through as-is, no file parsing) —
   or skip the password entirely and use `MATRIX_ACCESS_TOKEN`.
3. **Room ID** to deliver to → `MATRIX_ROOM_ID` (e.g. `!abcdef:matrix.illegal.trading`).

**Important:** the room must **not be end-to-end encrypted**. A plain HTTP bot cannot produce
Megolm keys; E2EE rooms would require a full crypto stack. Create an unencrypted room (or an
unencrypted DM) for deliveries.

At delivery time the audio is uploaded via the authenticated media API
(`/_matrix/client/v1/media/upload`, legacy fallback included) and sent as an `m.audio` message
annotated with `org.matrix.msc3245.voice` (plus `org.matrix.msc1767.audio` duration), which
Element and other clients render as a voice message with waveform/play button.

### Matrix chat commands

With `MATRIX_CHAT_COMMANDS=true` (default) the bot listens in the configured room via
`/sync` long-polling and reacts to text messages:

| Command | Effect |
| --- | --- |
| `/start <task id or name>` | runs a scheduled task immediately (off schedule); replies again when it finishes or fails |
| `/list` | lists scheduled tasks (name, workflow, cron, state, short id) and workflows |
| `/status` | shows integration configuration status |
| `/help` | usage |

Details: the sync position is persisted (SQLite `kv` table), so restarts never replay history or
re-execute old commands; the bot ignores its own messages; `MATRIX_ALLOWED_SENDERS`
(comma-separated Matrix IDs) can restrict who may issue commands — by default anyone in the room
can. Sync errors back off and resume automatically, and a re-login transparently resets the sync
position.

### Web UI

The frontend is built entirely on the [M3 Svelte](https://github.com/KTibow/m3-svelte) Material 3
design system (buttons, text fields, lists, tabs, cards, chips, snackbars), themed with the M3
baseline palette in light and dark mode (`web/src/app.css`) plus the Google Sans Flex font.
Only truly custom pieces are hand-styled (the dense event log and the audio element), and even
those use the M3 design tokens.

## Topics and scheduled tasks

- **Topics** are managed in the UI (or by sending `topic.create` / `topic.delete` / `topic.list`
  through the webhook). Each topic is researched on the web and on Bluesky, then the compiler
  groups the brief by topic.
- **Scheduled tasks** live in SQLite and use `Bun.cron` (standard 5-field expressions, in the
  server's `TZ`). Runs never overlap; every run's result is recorded and every step is emitted as
  an event.
- On first boot a `morning-brief` job is seeded with `DEFAULT_BRIEF_CRON` (default daily 07:00).
  Edit it in the UI, or create additional tasks — any registered workflow can be scheduled
  (currently `briefing`).
- Workflows accept an input object, e.g. `{"topics": ["Rust"], "deliver": false}` for a
  research-only run.

## Message gateway (webhooks only)

The service deliberately has **no REST endpoints and no streaming endpoints**.
Everything — including every UI interaction — is a webhook message:

- **The only endpoint:** `POST /api/webhook`. `GET /api/webhook` returns `200` with the
  available message types and doubles as the liveness probe.
- Everything else under `/api/*` is `404`; `/*` serves the built UI.

Message envelope:

```json
{ "type": "topic.create", "payload": { "name": "Rust" }, "correlationId": "optional-uuid" }
```

The gateway publishes `message.received` (audit, except for read-only types) and dispatches the
message to its handler. The handler result comes back **in the same HTTP response**:

```json
{ "ok": true, "type": "topic.create", "correlationId": "…", "result": { "id": "…" } }
```

Errors use proper status codes (`400` validation, `404` unknown type, `502` provider failure) with
`{ "ok": false, "error": "…", "code": "…" }`. Types starting with `hook.*` are fire-and-forget:
they are forwarded to the bus as `hook.<channel>` events and answered with `202`.

**Event feed:** the UI reads events through the same webhook with `event.pull` (`{ since, limit }`)
and `event.wait` — a long-poll that returns as soon as an event newer than `since` exists, or an
empty list after `timeoutMs` (max 55s). The UI loops on `event.wait`, which keeps the feed live
without any streaming connection. Read-only message types (`event.*`, `*.list`, `*.get`,
`brief.audio`, `config.get`) are "quiet": they generate no audit events, so polling can never feed
itself.

Built-in message types: `config.get`, `topic.list/create/delete`, `job.list/create/update/delete/run`,
`workflow.list/run`, `brief.list/get/audio`, `event.pull/wait`. Adding one is
`router.register("my.type", handler)` in `src/commands/registerCommands.ts`.

## Startup validation

On boot (controlled by `STARTUP_CHECK`, default `true`) the engine validates every configured
integration and sends the result as a **startup message to the Matrix room**:

- `llm` — `GET /models` on the LLM endpoint (no tokens spent)
- `perplexity` — one `search_type: "fast"` probe query
- `bluesky` — a real `searchPosts` call through the PDS (skipped in public mode)
- `elevenlabs` — verifies the configured voice exists
- `web-search` — one result through the configured search provider
- `matrix` — active pre-flight: resolves credentials (login if needed), `whoami`, and confirms
  the bot is **joined to the target room**
- then it announces the summary to the room (unless Matrix is unconfigured)

Unconfigured integrations are reported as `skipped` (not failures); each check has a 20s timeout.
Every check and the summary are published as events (`system.check.completed`,
`system.validation.completed`, `system.startup.announced` / `system.startup.announce_failed`), so
they show up in the Live events view. A failed Matrix announce does not crash the boot.

## Events

Everything publishes to the event bus: `topic.*`, `job.*`, `workflow.*`, `agent.*` (including
`agent.tool.invoked/succeeded/failed`), `brief.*`, `tts.synthesized`, `message.voice.sent`,
`hook.received`, `system.*`. Events are persisted in SQLite (`events` table) and read back through
the webhook via `event.pull` / `event.wait`, which is what makes the Svelte live view resumable.

Known topics are typed in `src/core/events/AppEvents.ts`. Arbitrary topics (e.g. inbound hooks)
are supported.

## Deployment (Coolify + Pangolin)

The `Dockerfile` builds the Svelte UI and runs the server on the Bun slim image.

- **Port:** `8080`. Point Coolify's healthcheck at `/api/webhook` (the image also ships a
  `HEALTHCHECK` that probes it).
- **Volume:** mount a volume at `/app/data` (SQLite database, `DB_PATH=/app/data/app.db`).
- **Env:** all variables from `.env.example` (`TZ` controls cron and brief dates; `STARTUP_CHECK`
  controls the boot validation + startup message).
- **Pangolin:** the app has no built-in auth — Pangolin handles that. The UI's event feed uses
  `event.wait` long-polls (≤ ~30 s per request); make sure the proxy's read/response timeout for
  `/api/webhook` is above that (Pangolin's default is fine). No WebSocket or SSE support needed.

```bash
docker build -t briefing-engine .
docker run --rm -p 8080:8080 -v briefing-data:/app/data --env-file .env briefing-engine
```
