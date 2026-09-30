# Briefing Engine

A modular, event-driven TypeScript service that periodically researches topics you care about,
compiles a neutral morning brief, turns it into speech, and delivers it as a voice message.

Built on **Bun** (runtime, SQLite, HTTP server, cron), **TypeScript 7**, **Svelte 5**, and an
event bus that every subsystem publishes to from the ground up.

## How it works

```
scheduler (Bun.cron, jobs in SQLite)          Matrix message (reply chain resolved)
   └─> workflow runner: persists a run, dispatches triggers ──────────┘
        briefing workflow                          qa workflow
          research agent (code mode: writes one program per run)
            └─ run_code ─┬─ web_search      → Perplexity Search API
                         ├─ finance         → Perplexity Agent API
                         ├─ bluesky_search  → AT Protocol searchPosts
                         └─ past_briefs     → SQLite brief history
          compiler LLM → neutral markdown brief + spoken narration
          follow-up subagents → implications/context → recompile
          Qwen3-TTS    → speech audio (local server)
          Matrix       → voice message (MSC3245)
                                                                       ▼
                            every step publishes typed events → EventBus → SQLite event log
                                                              │                    │
                                              Svelte UI ◄─────┴── webhook event.wait (event feed)
                                              Svelte UI ◄──────── WS /api/ws (live status feed)
```

### Architecture

| Layer | Location | Purpose |
| --- | --- | --- |
| Core | `src/core` | event bus + persisted event store, scheduler, workflow registry, workflow runner, trigger dispatcher, logger, errors |
| Capabilities | `src/capabilities` | provider-agnostic interfaces: `LlmProvider`, `SearchProvider`, `FinanceProvider`, `TextToSpeechProvider`, `MessagingProvider` |
| Providers | `src/providers` | concrete integrations (OpenAI-compatible LLM, Perplexity, Bluesky, local Qwen3-TTS, Matrix; the ElevenLabs module is kept but unused) |
| Domain | `src/domain` | SQLite repositories: contexts, workflow runs, generic artifacts (briefs and their audio are artifacts), topics, scheduled jobs |
| Agents | `src/agents` | generic `Agent` tool-calling runtime + `CodeModeTool` (sandboxed code mode) and the search/finance/brief tools it wraps |
| Workflows | `src/workflows` | `BriefingWorkflow` (research → compile → TTS → delivery) and `QuestionWorkflow` (Matrix follow-up answers) |
| Command handlers | `src/commands` | application message handlers (contexts, topics, jobs, briefs, workflows, runs) |
| API | `src/api` | single webhook gateway + static UI (no other endpoints) |
| UI | `web` | Svelte 5 + Vite frontend built on the **M3 Svelte** Material 3 design system |

Adding a provider means implementing one interface and wiring it in `src/kernel/Kernel.ts`.
Adding an agent capability means implementing `Tool` and passing it to an `Agent`.

### Swapping implementations

Everything the engine depends on externally sits behind a small interface, and
`src/kernel/Kernel.ts` is the only place that picks concrete implementations:

| Capability | Interface | Default implementation |
| --- | --- | --- |
| LLM text generation | `LlmProvider` (`src/capabilities/llm`) | `OpenAiCompatibleLlmProvider` (OpenCode Go) |
| Web search | `SearchProvider` (`src/capabilities/search`) | `PerplexitySearchProvider` |
| Social search | `SearchProvider` | `BlueskySearchProvider` |
| Financial data | `FinanceProvider` (`src/capabilities/finance`) | `PerplexityFinanceProvider` |
| Speech | `TextToSpeechProvider` (`src/capabilities/tts`) | `QwenTtsProvider` (local server) |
| Messaging | `MessagingProvider` (`src/capabilities/messaging`) | `MatrixMessagingProvider` |
| Persistence | `EventLog`, `ArtifactStore`, `TopicStore`, `BriefStore`, `JobStore`, `KeyValueStore`, `ContextStore`, `WorkflowRunStore` | SQLite repositories (`src/domain`, `src/core/events`) |

`createKernel()` accepts overrides for every provider (`llm`, `webSearch`, `socialSearch`,
`finance`, `tts`, `messaging`) and for storage (`stores: { events, artifacts, topics, briefs, jobs,
kv, contexts, runs }`) — override all stores and the kernel never opens SQLite (`kernel.db` is
`null`). No consumer imports a concrete provider or database: workflows, agents, tools and command
handlers only know the interfaces. Providers may implement an optional `verify()` (checked with
`isVerifiable`) so startup validation runs through the interface instead of reaching into config or
HTTP details.

### Code mode (efficient tool use)

The researcher does not call search tools one by one. It gets a single `run_code` tool and writes one
small JavaScript program per run. The program executes in a sandboxed Bun subprocess where the tools
are exposed as async functions — `perplexity_search`, `bluesky_search`, `perplexity_finance`,
`past_briefs`, `past_brief` — and reaches the engine's real providers over a stdio bridge. Only the
program's return value and captured `console.log` output come back to the model, so searches run in
parallel with `Promise.all`, results are filtered, merged and trimmed in code, and just the compact
findings enter the model context. Tool calls never throw: a failed provider call resolves to
`{ error, results: [], briefs: [], data: [], answer: "" }`, so one flaky search (a Bluesky 504, a
finance timeout) cannot abort the program — the code carries on with whatever succeeded. This is
the pattern behind Cloudflare's Code Mode and the CodeAct
paper: it removes the per-search model round-trip (and the intermediate results) that dominate token
and latency cost.

Guardrails: an inactivity timeout (60 s without progress) plus a hard wall-clock cap (3 min), a
tool-call budget (12 per program, plus the agent's own), clipped result and log sizes, and a screen
that rejects code touching `fetch`, `process`,
`Bun`, dynamic imports, `eval` and friends. The subprocess gets a stripped environment (no API keys)
and the worker removes network/process globals before evaluating the program. This is a sandbox of
convenience, not a hardened security boundary — model code still runs with the engine user's file
permissions, so the screening, budgets and timeout are the real controls. The follow-up Q&A agent
keeps direct tool calls, since it only needs one or two simple lookups.

### Artifacts (generic outputs)

Every workflow output is stored as a generic **artifact** in one `artifacts` table — text payloads
(markdown, JSON, plain text) and binary payloads (audio) alike. An artifact carries its `kind`,
`name`, `content_type`, `metadata` (JSON), the `workflow` and `correlationId` of the run that
produced it, its `contextId`, and an optional `parentId` pointing at the artifact it belongs to.
Nothing in the storage layer is brief-specific; any future research workflow can persist its
outputs the same way.

Briefs are the first typed view over that storage (`src/domain/briefs/BriefRepository.ts`):

- the brief is a `brief` artifact: markdown as `content`, topics/narration/sources in `metadata`;
- its speech is an `audio` artifact whose `parentId` is the brief, with `briefId`/`durationMs` in
  metadata;
- the brief artifact references it back through `metadata.audioArtifactId`, and `brief.get` /
  `brief.list` expose both ids (`artifactId`, `audioArtifactId`), so everything is traceable
  end-to-end: workflow run → brief artifact → audio artifact;
- deleting the brief artifact cascades to its audio.

The generic surface is available over the webhook: `artifact.list` (filter by `kind`, `workflow`,
`parentId`, `correlationId`, `contextId`), `artifact.get`, `artifact.content`, `artifact.data`
(base64 data URL) and `artifact.delete`. `artifact.created` / `artifact.deleted` events carry the
artifact id, kind and parent, so the event log records every output of every run. The existing
`brief.*` commands are a convenience view over the same rows. There is no migration from the old
`briefs` table — nothing is deployed yet, so pre-artifacts databases are rejected at boot: delete
the database file and start fresh.

### Workflows, contexts and runs

Workflows are **code-registered** definitions (`src/workflows`, registered in
`src/kernel/Kernel.ts`) implementing the `Workflow` interface — an id, a description, an optional
`contextId`, optional extra trigger bindings, and a `run(input, context)` method. The registry only
stores definitions; execution lives in `WorkflowRunner`.

- **Contexts** are named scopes that own topics, scheduled jobs, workflow runs and artifacts (all
  carry a `context_id`). The first context is `morning-briefing`; the briefing workflow and the
  seeded job live there. `context.list` returns each context with its topic/job/run/artifact counts.
- **Workflow runs** are persisted in `workflow_runs`: id (= the run's correlation id, which every
  event, status entry and artifact references), workflow, context, trigger kind, trigger detail,
  status (`running` / `succeeded` / `failed` / `skipped`), input, output, error and timestamps.
  Every trigger goes through `WorkflowRunner.start()`, which creates the record, publishes
  `workflow.started` / `workflow.finished` / `workflow.failed` (all carrying `contextId` and
  `trigger`), and finishes the record. A run whose output contains `{"skipped": true}` is marked
  `skipped` (the "nothing relevant found" path).
- **Triggers:** scheduled jobs (cron) and manual runs are implicit; workflows can add extra
  bindings, e.g. `QuestionWorkflow` binds `matrix` with `when: (detail) => detail.replyToBot`.
  `TriggerDispatcher.dispatch(kind, …)` fans a trigger out to every bound workflow and returns the
  finished runs; a failing workflow never breaks the others.
- **Per-run activity:** status entries carry the run's correlation id, and the Workflows UI tab
  filters the live activity feed to a single run and lists the artifacts it produced
  (`workflow.run.list`, `workflow.run.get` — the latter includes the run's artifacts). The top
  Activity card keeps showing the live overview of the newest run.

The Workflows tab is a drill-down: pick a workflow from the list (context filter on top, **Run
now** per workflow), then pick a run from that workflow's runs sidebar, then inspect the run —
live status feed, output/error preview and the artifacts it produced. Clicking an artifact opens
it in a right-hand drawer: briefs render as markdown with citation pills, audio plays inline,
images preview, other artifacts show their text or metadata. `workflow.list`,
`workflow.run.list`, `workflow.run.get` and `workflow.run` (manual trigger, optional `contextId`)
are also available over the webhook.

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
- Defaults: `LLM_BASE_URL=https://opencode.ai/zen/go/v1`, `LLM_MODEL=deepseek-v4.1-flash`
  (OpenAI-compatible `/chat/completions`).
- OpenCode Go requires a client user agent and a stable `x-opencode-session` id per conversation.
  The engine sends both automatically: the session id is the id of the workflow run (agent tool
  loop and compiler share one conversation), falling back to `LLM_SESSION_ID` if set, then to a
  per-process uuid. Pin `LLM_SESSION_ID` if you want one routing/cache session across runs.
- `bun run check:llm` sends one tiny completion to verify the key/endpoint end-to-end.

### Perplexity (web + finance)

- Create an API key → `KEY_PERPLEXITY`.
- **Web search:** the agent calls `POST https://api.perplexity.ai/search` and receives raw ranked
  results (`title`, `url`, `snippet`, `date`) — no LLM answer in the loop. Searches are limited to
  the last 3 days (`DEFAULT_SEARCH_RECENCY`, one of `hour`/`day`/`3days`/`week`/`month`/`year`; the
  3-day window uses Perplexity's publication-date filter) and to English
  (`DEFAULT_BRIEF_LANGUAGE` → `search_language_filter`).
- **Reputable-source filter:** web searches send Perplexity's `search_domain_filter` allowlist, so
  results come from Wikipedia, major wires and outlets with strong correction records, quality
  tech/science press and `.gov` primary sources. Root domains match their subdomains and `.gov`
  matches the whole TLD. Tune it with `DEFAULT_SEARCH_DOMAINS` (comma-separated, max 20) or set it
  to `off` to search the whole web; the researcher can also pass `scope: "open"` per query when a
  topic needs an official or niche page (release notes, docs).
- **Finance lookups:** when a topic touches a public company, an ETF or the markets, the researcher
  can call the `perplexity_finance` tool. It uses Perplexity's Agent API
  (`POST https://api.perplexity.ai/v1/agent`) with the `finance_search` tool, which returns a
  synthesized answer plus structured data — quotes, financial statements, earnings, guidance,
  analyst estimates, ownership — with citation-ready `perplexity.ai/finance/…` source links that
  flow into the brief's source list.
- `finance_search` runs on a Perplexity-hosted model. `PERPLEXITY_FINANCE_MODEL` defaults to
  `perplexity/glm-5.3-flash` — the best open-weight model on Vals AI Finance Agent v2 (57.9%,
  ahead of DeepSeek V4 Pro 0813 at 50.4%, Kimi K3 at 54.4% and MiniMax M3 at 48.3%) and the
  cheapest capable option. The research agent and compiler keep running on `LLM_MODEL`
  (`deepseek-v4.1-flash`).
- `finance_search` is a beta, per-invocation billed tool (see Perplexity's docs) and must be
  enabled for your key; if a lookup fails the researcher continues with web/social results and the
  error is visible in the activity feed.

### Qwen3-TTS (speech, local)

Speech is synthesized by a **local Qwen3-TTS server** speaking the OpenAI `POST /audio/speech`
interface — no text leaves the machine. Any of the common servers works: vLLM-Omni
(`vllm serve Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice --omni`), Qwen3-TTS-Openai-Fastapi,
qwen3-tts-server, or a similar wrapper.

- `QWEN_TTS_BASE_URL` — server base URL including `/v1` (required; e.g.
  `http://127.0.0.1:8880/v1`). Speech is skipped entirely when it is unset, and briefs are
  delivered as text.
- `QWEN_TTS_MODEL` — model name; most local servers accept and ignore it (`tts-1`).
- `QWEN_TTS_VOICE` — preset speaker (`Ryan`, `vivian`, `serena`, …) or an OpenAI alias
  (`alloy`, `nova`, …); the server maps aliases.
- `QWEN_TTS_FORMAT` — `opus` (default) renders as a native voice bubble in Matrix clients;
  `wav`/`mp3`/`flac`/`aac`/`pcm` also work. Many local servers ignore the format and always
  return WAV; the engine detects that and converts to Ogg/Opus with ffmpeg when ffmpeg is on
  `PATH` (falling back to the server's audio if it is not).
- `QWEN_TTS_SPEED`, `QWEN_TTS_LANGUAGE` (e.g. `English`) and `QWEN_TTS_API_KEY` are optional.
- Resilient by default: transient failures (429/5xx, network errors) are retried twice with
  backoff and error messages include the server's own explanation. If speech generation still
  fails, the compiled brief is **delivered as a text message instead** — a flaky TTS call never
  throws away a good brief.

The ElevenLabs provider module is kept in the repo but unused; its `ELEVENLABS_*` settings are
ignored.

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
authenticated reads). Transient upstream failures (502/503/…) are retried with backoff, and if the
PDS search endpoint still fails the provider falls back to the public AppView instead of failing
the whole research run.

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

**Follow-up questions:** every allowed message is handed to the trigger dispatcher (plain messages
are still treated as commands). The `qa` workflow is bound to Matrix messages that are replies to
(quotes of) one of the bot's own messages — the brief summary, a notice, or one of its answers —
and answers with a short **text** answer, never a voice message. The trigger resolves the whole
reply chain (`m.in_reply_to` upwards, capped at 10 events / 8k characters, oldest first) and
passes it to the workflow, so "what about that?" still has a referent. The qa workflow is a normal
persisted run: it appears in the Workflows tab with its activity and artifacts, and a failed run
gets a "Sorry, I couldn't answer that: …" reply.

### Web UI

The frontend is built entirely on the [M3 Svelte](https://github.com/KTibow/m3-svelte) Material 3
design system (buttons, text fields, lists, tabs, cards, chips, snackbars), themed with the M3
baseline palette in light and dark mode (`web/src/app.css`) plus the Google Sans Flex font.
Only truly custom pieces are hand-styled (the dense event log and the audio element), and even
those use the M3 design tokens.

The whole app is a full-width three-pane layout: a navigation rail on the left (sections plus a
single engine-health pill — green when every integration is configured and the event stream is
live, red when anything is down), a content list in the middle, and a details pane on the right.
Lists never overflow their rows: long names, overlines and supporting lines ellipsize.

The Briefs list shows each brief with colour-coded badges (topic count, source count, audio
availability). The details view shows the full summary, plays the stored audio, offers
**Re-send** to deliver the brief to Matrix again (formatted summary + voice), **Generate voice**
for text-only briefs, and can **delete** a brief behind an M3 confirmation dialog.

The Workflows tab shows contexts, workflow definitions (with **Run now**), recent runs and — when
you open a run — its live per-run activity feed, output/error preview and the artifacts it
produced. The Activity card at the top keeps showing the live overview of everything running.

## Topics and scheduled tasks

- **Topics** are managed in the UI (or by sending `topic.create` / `topic.update` /
  `topic.delete` / `topic.list` through the webhook), including a **mute toggle** in the list and
  the details pane — muted topics are excluded from every briefing until unmuted. One LLM-planned
  research run covers all topics at once (they may overlap), the compiler merges everything into a
  single brief, and the researcher can pull concrete market numbers (quotes, revenue, margins,
  guidance, estimates) through Perplexity finance lookups when a topic involves a public company
  or the markets.
- **Delivery is two messages by default:** the compiled summary as a formatted text message
  (markdown rendered to Matrix `formatted_body`) followed by the voice message. The summary is
  written for spoken delivery under a hard brevity budget (under ~150 words) — the compiler is
  TTS-aware (speakable sentences, symbols written out, everyday expressions kept neutral) and the
  narration is derived from the summary itself, so the audio reads the same text minus the links.
- **Inline citations:** the compiler receives the numbered source list together with the research
  notes and cites every factual claim with a marker like `[4]`. The UI renders those markers as
  small clickable numbered pills linking to the source, and the Matrix text message turns them
  into clickable links. The markers are stripped from the spoken narration automatically, and the
  grouped source list below the brief stays as the full reference.
- **Voice is optional per run:** scheduled tasks accept `{"generateAudio": false}` (the Jobs UI
  has a mic toggle at creation and per task), and the manual "Run briefing now" button has its
  own mic toggle — text-only runs skip TTS entirely and deliver just the formatted summary.
- **Voice on demand:** a text-only brief can get its audio later from the Briefs view
  (*Generate voice*) or via `brief.audio.generate { id }` — the speech is generated, stored, and
  automatically sent to Matrix as a voice message. `regenerate: true` forces new audio,
  `deliver: false` only generates. The Briefs view also has a **Re-send** button, and
  `brief.send { id }` does the same over the webhook.
- **Relevance-checked research:** the researcher agent finishes with a `{"found": <bool>, "notes":
  …}` verdict, and its tool budget is capped. Search engines return junk even for nonsense
  queries, so if no topic yields *relevant* material the workflow writes **no summary and sends
  no audio** — instead you get a plain text notice listing the topics and the exact queries that
  were tried. Topics that found nothing are marked as missing when other topics did have
  material. The same notice path is used when the agent runs out of steps or returns empty notes,
  and the compiler is never allowed to store an empty brief.
- **Follow-up research:** once the first draft exists, a planner model looks for claims that deserve
  a deeper look — implications, causes, missing context — and dispatches up to three subagents (one
  question each). Every subagent can use Wikipedia, the reputable web search, social search and past
  briefs and returns compact findings with attributions; their sources are merged into the brief's
  source list and a short **"Implications" section is appended** to the brief — which is also read
  aloud with the rest. If nothing qualifies, or the follow-ups find nothing, the draft is kept
  unchanged, and a failed follow-up never throws away a good brief. Disable the whole step with
  `DEFAULT_FOLLOWUP_RESEARCH=false`.
- **Scheduled tasks** live in SQLite and use `Bun.cron` (standard 5-field expressions, in the
  server's `TZ`). Runs never overlap; every run's result is recorded and every step is emitted as
  an event.
- On first boot a `morning-brief` job is seeded with `DEFAULT_BRIEF_CRON` (default daily 07:00).
  Edit it in the UI, or create additional tasks — any registered workflow can be scheduled
  (currently `briefing`).
- Workflows accept an input object, e.g. `{"topics": ["Rust"], "deliver": false}` for a
  research-only run.

## Message gateway (webhooks only)

There are **no REST endpoints**. Data flows two ways:

- **`POST /api/webhook`** — the only ingress; every UI interaction and every external message
  goes through it (see below). `GET /api/webhook` returns `200` with the available message types
  and doubles as the liveness probe.
- **`GET /api/ws`** — the one WebSocket, used exclusively for the ephemeral live status feed
  (see "Live activity feed"). Nothing else is served except the static UI.

Message envelope:

```json
{ "type": "topic.create", "payload": { "name": "Rust" }, "correlationId": "optional-uuid" }
```

The gateway publishes `message.received` (audit, except for read-only types) and dispatches the
message to its handler. Handler results come back **in the same HTTP response**:

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

Built-in message types: `config.get`, `context.list`, `topic.list/create/update/delete`,
`job.list/create/update/delete/run`, `workflow.list/run/run.list/run.get`,
`brief.list/get/audio/audio.generate/send/delete`,
`artifact.list/get/content/data/delete`, `event.pull/wait`. Adding one is
`router.register("my.type", handler)` in `src/commands/registerCommands.ts`.

## Live activity feed (WebSocket)

`GET /api/ws` pushes an ephemeral, in-memory status feed to the UI (broadcast by
`src/core/status/StatusHub.ts`, not persisted):

- On connect the client receives a `snapshot`, then incremental `entry` messages.
- Entries are **coarse, workflow-level only**: `Researching "<topic>"`, `Compiling brief` /
  `Waiting for the compiler model`, `Generating speech` / `Waiting for the local TTS server`,
  `Sending voice message` / `Waiting for Matrix`, follow-up spans, plus job lifecycle entries
  (`Running job "…"`, finished/failed) and skipped/failed notices. Tool- and model-level activity
  (`Calling tool <tool>`, `Model requested N tool call(s)`, …) is **not** surfaced to the UI — it
  stays in the persisted event log as `agent.tool.*` / `agent.*` events for debugging.
- Running entries show an animated M3 spinner and are **grouped at the bottom of the list**, so
  parallel tasks always stay together; settled history (dimmed) sits above them in settle order.
  Running entries keep a stable order even while their status text updates repeatedly.
- Sub-activities are nested: a workflow's spans are indented under the span that owns them (e.g.
  follow-up questions under the research span). Each nested section is capped at 200px, sticks to
  its newest entries (just the last few actions stay visible), and fades out its top while there is
  older history above.
- When nothing is running the header chip shows `idle`, otherwise the running count.
- The feed keeps the last ~120 entries, auto-reconnects, and re-syncs via snapshot. If the
  WebSocket is unavailable (stopped backend, strict proxy), the UI simply shows no live status;
  everything else keeps working.

## Startup validation

On boot (controlled by `STARTUP_CHECK`, default `true`) the engine validates every configured
integration. The results are logged and shown in the activity feed; with `STARTUP_ANNOUNCE=true`
(default **off**) a summary is also sent as a text message to the Matrix room:

- `llm` — `GET /models` on the LLM endpoint (no tokens spent)
- `perplexity` — one `search_type: "fast"` probe query
- `bluesky` — a real `searchPosts` call through the PDS (skipped in public mode)
- `tts` — the local Qwen3-TTS server answers on `{QWEN_TTS_BASE_URL}/models`
- `web-search` — one result through the configured search provider
- `matrix` — active pre-flight: resolves credentials (login if needed), `whoami`, and confirms
  the bot is **joined to the target room**
- unconfigured integrations are reported as `skipped` (not failures); each check has a 20s timeout

Every check and the summary are published as events (`system.check.completed`,
`system.validation.completed`, `system.startup.announced` / `system.startup.announce_failed`), so
they show up in the Live events view. A failed Matrix announce does not crash the boot.

## Events

Everything publishes to the event bus: `topic.*`, `job.*`, `workflow.*`, `agent.*` (including
`agent.tool.invoked/succeeded/failed`), `artifact.created/deleted`, `brief.*`, `tts.synthesized`,
`message.voice.sent`, `hook.received`, `chat.*` (commands, `chat.message.received` for every allowed
message, and follow-up Q&A), `system.*`. Events are
persisted in SQLite (`events` table) and read back through the webhook via `event.pull` /
`event.wait`, which is what makes the Svelte live view resumable.

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
