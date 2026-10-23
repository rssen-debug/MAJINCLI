# MAJIN V4 — architecture

**Status:** working private vertical slice. Release **NOT READY** (see `PROGRESS.md`).
**Branch:** `v4/main` · **Base:** V3 `df678b21dfb784233da8cea25bdc54722a61236a`

## 1. Shape

```
iPhone Safari / Android Chrome / desktop browser
        │  HTTPS (tunnel terminates TLS)
        ▼
Private tunnel  →  MAJIN V4 host  (127.0.0.1 on the Windows PC)
        │
        ├── auth.js        pairing → signed session cookie (HttpOnly, SameSite=Strict)
        ├── security.js    host allowlist, origin/CSRF checks, rate limits, body caps
        ├── server.js      HTTP + SSE, one route table, no framework
        ├── agent.js       one turn = one durable V2 Goal
        ├── tools.js       workspace + memory tools behind the V2 tool runner
        ├── model.js       V1 provider transports, or a labelled demo brain
        ├── models.js      model discovery from the EXISTING V1 config
        ├── store.js       conversations + goals on disk (atomic writes)
        ├── kernel.js      versioned capability API, plugins, feature flags
        ├── voice.js       server-side TTS through the V2 voice lane (optional)
        └── ui/            PWA: index.html, app.css, app.js, session.js, spirit.js, voice.js, strings.js
```

Modular monolith. One process, one port, no microservices. The browser is an
untrusted client; every tool runs on the host behind an approval decision.

## 2. Reuse decisions (what is borrowed, not rebuilt)

| Capability | Source kept verbatim | Where V4 uses it |
|---|---|---|
| Goal lifecycle + state machine | `src/v2/runtime/states.js`, `goal.js` | every turn |
| Evidence + receipts | `src/v2/runtime/receipts.js` | every tool call |
| Verification | `src/v2/runtime/verifiers.js` (`file`, `http`, `pixel`, `dom`) | workspace writes |
| Tool contract + policy | `src/v2/tools/registry.js`, `runner.js` | all tools |
| Consent model | `src/v2/safety/approvals.js` | `strict` policy |
| Memory | `src/v2/memory/store.js` | preferences |
| Provider transport | `src/core/provider/chat.js` + `openai.js`/`anthropic.js` | real model calls |
| Live model catalog | `src/core/provider/catalog.js` (pagination, per-provider auth, origin pinning) | `/api/models?refresh=1` |
| Speech synthesis + verification | `src/v2/voice/speak.js`, `tts.js` | `POST /api/voice/speak` (opt-in) |
| Speech recognition | `src/v2/voice/listen.js`, `stt.js` | `transcribe()` in `src/v4/voice.js` (library lane) |
| Rate limiting + classification | `src/core/ratelimit.js` | model admission |
| Config layout | `src/core/paths.js` rules (re-implemented narrowly in `config.js`) | data dir |

Nothing was copied wholesale: V4 imports these modules from the same tree, so a
V1/V2 bug fix reaches V4 without a port. V1/V2/V3 entry points are untouched.

## 3. Turn lifecycle

```
POST /api/chat  ──SSE──▶  open → user → goal(PLANNING) → state(thinking)
                              → tool_start → tool_result (verified?)
                              → goal(RUNNING/VERIFYING/COMPLETED) → done
```

Every tool call produces a receipt. A workspace write is only reported as done
after `runVerifier('file', {path, minBytes, hash})` re-reads the file from disk
and matches its SHA-256. The model's own sentence is never the evidence.

Crash honesty: a goal saved as `RUNNING` when the process died is marked
`BLOCKED` on the next boot (`GoalStore.reconcileOnBoot`). It is never silently
resumed and never reported complete.

Idempotency: each turn carries a `requestId`. A repeated id returns the stored
answer; tools do not run twice. This is what makes a phone reconnect safe.

## 4. Model routing

1. `MAJIN_V4_BASE_URL` + `MAJIN_V4_API_KEY` + `MAJIN_V4_MODEL` (explicit).
2. The existing V1 config (`$MAJIN_CONFIG` or `<MAJIN_HOME>/config.json`):
   `models.routes.chat` → `providers[name]`. Keys stay on the host.
3. Demo brain — deterministic, labelled `demo: true` in every response and in
   the UI. It is not a language model and cannot pretend to be one.

`GET /api/models` returns provider labels, model ids, `configured` and a
`liveVerified` flag that only turns true after a real call in this process. Raw
keys, base URLs and Authorization headers never cross the API.

`?refresh=1` calls **V1's own catalog code** (`src/core/provider/catalog.js`) to
list each keyed provider's real models — no second discovery implementation.
Results are cached in `v4/model-cache.json` for 6 h (`MAJIN_V4_MODEL_CACHE_TTL_MS`),
a hung provider is cut off at 8 s, and a provider error is stored as an error,
not converted into an empty-but-happy list. A model found only via the catalog
is marked `discovered` and stays routable **only while its cache entry is
fresh**; the provider endpoint still comes from the config.

Selection scope is **per conversation** (`POST /api/model`), validated against
the discovered catalogue, so the phone cannot point MAJIN at an arbitrary
endpoint and cannot silently change desktop route defaults.

## 5. Security boundary

* Loopback bind by default; the public surface is a tunnel, never a port forward.
* Pairing code: 8 chars from a 32-symbol alphabet, HMAC-SHA256 hashed at rest,
  file mode 0600, rotated with `npm run v4:pair -- --rotate`.
* Session: server-side record + HMAC signature, HttpOnly, SameSite=Strict,
  Secure when the request is HTTPS, revocable, expiring (30 days default).
* Every mutating request needs `X-MAJIN-CSRF: 1` **and** a same-origin
  `Origin`/`Referer`, on top of a valid session.
* Host-header allowlist defeats DNS rebinding; CSP forbids inline script,
  framing and third-party origins.
* Tools can only touch a flat, create-only workspace; traversal, reserved
  Windows names and overwrite are refused before the filesystem is touched.
* Rate limits: pairing, turns and general requests, per client key.

Known limits: no CSRF tokens per form (header + same-origin instead), the
session store is a JSON file (single-host), and there is no distributed rate
limiter. Those are deliberate choices for a single-owner private deployment.

## 5.0 Turn journal (connection survival)

A turn is not owned by an HTTP response. `src/v4/turns.js` records every emitted
event with a sequence id and keeps the last 50 turns / 10 minutes in memory.
`POST /api/chat` starts the turn first and then streams it, so the client learns
`turnId` in the `open` event; `GET /api/chat/stream?turnId=…&from=<seq>` replays
what was missed and continues live.

Consequences that matter on a phone:

- hanging up (Wi-Fi → cellular, backgrounded tab) no longer aborts the work;
- `POST /api/cancel` is the only thing that stops a turn;
- a reconnecting client never re-executes a tool: it only receives events.

## 5.1 Client state

The browser keeps its conversation state in `src/v4/ui/session.js`: a pure
reducer over the same SSE events the server emits, plus an SSE parser. It is
imported by `app.js` and tested directly, including a real HTTP round trip that
asserts a second message stays in the first conversation. The server is the
authority for `conversationId`; the client never invents one.

Why it exists: the first version hashed this logic into the DOM and silently
lost the conversation id, so the app started a new thread on every message while
all server tests stayed green. Behaviour that only lives in the view is behaviour
nobody tests.

It is tested two ways: as a pure reducer (`client.test.js`) and by executing the
real `app.js` in jsdom against a real host (`client-dom.test.js`). The second one
drives the actual DOM — typing into `#input`, submitting `#composer`, waiting for
`.tool[data-state="verified"]` — so a wiring mistake cannot hide behind a green
unit test.

## 6. Platform kernel

`kernel.js` defines `KERNEL_API_VERSION = 1` and a frozen capability contract
(`tool`, `provider`, `voice`, `memory`, `surface`). A plugin is a directory
with `plugin.json` + `index.js`:

```json
{ "name": "hello", "version": "1.0.0", "kernelApi": 1,
  "description": "example", "permissions": ["workspace"],
  "capabilities": [{ "kind": "tool", "name": "hello" }] }
```

Guarantees: manifests validated with zod, capabilities must be declared,
write tools need the `workspace` permission, failed activation is rolled back
completely, plugins are opt-in (`MAJIN_V4_PLUGINS=1`), allowlistable
(`MAJIN_V4_PLUGIN_ALLOW=a,b`), and experimental plugins stay behind
`MAJIN_V4_FLAGS=experimental-plugins=1`.

**Isolation (shipped):** the host runs each plugin in its own child process
(`src/v4/sandbox.js` + `plugin-worker.js`) with an env allowlist (no keys, no
`NODE_OPTIONS`), an activation timeout, a per-call timeout, stdout/stderr drained,
and ordered shutdown. A crash, a hang or a flood is contained; the host keeps
serving. A plugin that fails during activation is moved to
`v4/plugins-quarantine/<name>-<stamp>/` with a `QUARANTINE.json` explaining why,
so the next boot does not retry it (`npm run v4:plugins` to inspect/restore).

**Not claimed:** this is process isolation, not a security sandbox. Same OS user,
same filesystem access. A hard boundary needs a separate account or a container.

## 7. Feature flags

`MAJIN_V4_FLAGS` — stable features default on (`voice`, `pwa`), experimental
default off. Flags are read once at boot so a request cannot flip behaviour
mid-turn.

## 8. What is deliberately absent

No desktop control, no browser automation endpoint, no shell tool, no public
unauthenticated demo, no multi-agent swarm, no always-listening microphone.
Each is a capability that needs its own evidence gate before it may exist in
the product; adding stubs would violate the honesty rule this repo runs on.
