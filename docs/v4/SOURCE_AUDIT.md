# MAJIN V4 — source audit (V1 / V2 / V3)

Recorded before the first V4 commit, by reading the code, not the READMEs.

## 0. Baseline SHAs

| Ref | SHA | State |
|---|---|---|
| V1 `main` | `e84b716e79ac4fc3cb443280e56d3f12553c8fc2` | protected, untouched |
| V2 `v2/main` | `1ef253fb1f44406c262a290e170902403f68cceb` | protected, untouched |
| V3 `v3/main` | `df678b21dfb784233da8cea25bdc54722a61236a` | protected, untouched |
| V4 `v4/main` | branched from V3 `df678b2` | this work |

## 1. Capability matrix

Maturity: **proven** = exercised by tests and used here; **usable** = works but
needs a host/credential; **scaffold** = structure without runtime evidence.

### V1 (`main`)

| Area | Module | Maturity | Reuse in V4 |
|---|---|---|---|
| Provider transport (SSE, tool calls, retries) | `src/core/provider/chat.js`, `openai.js`, `anthropic.js` | proven (source) | **used directly** |
| Rate limiting / classification | `src/core/ratelimit.js` | proven | used via `complete()` |
| Live model catalog | `src/core/provider/catalog.js` | proven | **used directly** by `/api/models?refresh=1` |
| Local HTTP server + SSE chat | `src/core/server/index.js` (914 lines) | usable | **not reused** — see §2.1 |
| Config + data dirs | `src/core/config.js`, `paths.js` | proven | path rules re-implemented narrowly; config file read as-is |
| Persona / style | `src/core/config.js` `persona` | text only | replaced by a V4 system prompt (mobile product voice) |
| Agent loop | `src/core/agent.js` (674 lines) | usable | **not reused**: it is CLI/desktop oriented and would drag the whole surface in |
| Tools | `src/core/tools/*`, shell/fs/browser | usable | not reused; V4 exposes a minimal typed workspace surface |
| Memory | `src/core/memory.js` | usable | V2 store preferred (cleaner contract) |
| Voice | V1 channels/voice are UI-bound | scaffold | not reused in the browser client |
| Windows install / startup | `install.ps1`, `start-majin.cmd` | usable | **task settings reused** (see below); V4 keeps its own launcher and task name |

### V2 (`v2/main`)

| Area | Module | Maturity | Reuse in V4 |
|---|---|---|---|
| Goal + states + receipts | `runtime/goal.js`, `states.js`, `receipts.js` | proven | **used directly, unmodified** |
| Verifiers (file/http/pixel/dom) | `runtime/verifiers.js` | proven | **used directly** |
| Tool contract + runner | `tools/registry.js`, `runner.js` | proven | **used directly** |
| Approvals | `safety/approvals.js` | proven | **used directly** |
| Memory store | `memory/store.js` | proven | **used directly** |
| DAG / scheduler / orchestrator | `runtime/dag.js`, `scheduler.js`, `orchestrator.js` | usable | not used yet — single-turn execution first (stage 2) |
| Supervisor / roles | `supervisor/*` | scaffold | not used; no multi-agent claims |
| Recovery advisor | `recover/advisor.js` | proven (pure, no deps) | **used directly** — maps a tool failure class to a bounded retry plan |
| Context packing | `context/engine.js` | proven (pure) | `estimateTokens` **used directly**; `pack()` not used (it flattens roles, see §4) |
| Telemetry ledger | `telemetry/ledger.js` | proven | **used directly** — fixed field allowlist per event |
| Telemetry aggregation | `telemetry/aggregate.js` | proven | `aggregate()` used; `renderReport()` not used (it titles the report for V2) |
| Outer recovery loop | `recover/outer-loop.js` | usable | not used: it drives V2's `runObjective`, which V4 does not run |
| Studio server/page | `studio/server.js` (517 lines) | usable | **not reused**: V4 needs a different trust model (session + tunnel) |
| Voice adapters | `voice/tts.js`, `stt.js` | scaffold (host binaries) | planned for server-side voice (matrix V7) |
| Telemetry / audit | `telemetry/*`, `audit/*` | usable | not wired yet |

### V3 (`v3/main`)

| Area | Module | Maturity | Reuse in V4 |
|---|---|---|---|
| Node 22 runtime floor | `platform/runtime.js` | proven | same rule re-stated in `config.js` |
| Loopback server + origin/host checks | `server.js` | proven | **pattern reused**, extended with auth, sessions and SSE |
| File vertical slice | `runtime/file-deliverable.js` | proven | superseded by the generic goal+tool path |
| Minimal UI | `ui/page.js` | proven | replaced by the mobile PWA |
| Acceptance matrix discipline | `docs/v3/*` | proven | **method kept**, new machine-validated matrix |

## 2. Why the V2 Studio server was not reused

`src/v2/studio/server.js` serves a desktop operator surface on loopback with no
session model. V4 needs: session cookies, CSRF, tunnel-aware origin checks,
SSE streaming, cancellation and idempotency. Bolting those onto Studio would
have changed its contract for existing V2 users. The security primitives were
re-used as patterns; the module stays intact for V2.

## 2.1 The V1 server: why it is not the V4 server

V1 already serves a full UI, `/api/chat` with SSE, `/api/models`, `/api/state`,
tasks, approvals and a WhatsApp webhook. Tempting to reuse wholesale. It is not
reused as the V4 front door because its trust model is *desktop-local*:

- the session secret is a static token that is also accepted in the **URL**
  (`?t=…`), in a cookie **without** `HttpOnly`/`Secure`, and as a bearer header;
- loopback peers are trusted **without any token** (`server.trustLocal`);
- `OPTIONS` answers with `access-control-allow-origin: *`;
- there is no CSRF requirement and no per-device revocation.

Every one of those is a reasonable localhost convenience and a vulnerability the
moment a tunnel publishes the port. Rewriting V1's auth for the internet would
change its contract for existing desktop users, so V4 keeps V1 untouched and
adds a thin, separately tested session layer. What *is* reused from V1 is the
part with no security coupling: the model catalog implementation.

## 3. Duplication ledger

| Built in V4 | Why not reuse |
|---|---|
| `security.js` (limits, host/origin) | V3's checks are one-shot and loopback-only; needed reusable, tested middleware |
| `store.js` (conversations) | No conversation persistence exists in V1–V3 |
| `models.js` (discovery) | V1 has a catalog but no safe, secret-free projection for a remote client — the *fetching* is V1's code, only the projection is new |
| `kernel.js` | No versioned capability contract exists in any prior version |
| `ui/*` | No mobile/PWA surface exists |

## 3.1 Windows autostart: what V1 taught V4

V1's `install.ps1` registers the `MAJIN` task with three settings that are easy to
miss and expensive to discover in production:

| Setting | What happens without it |
|---|---|
| `-AllowStartIfOnBatteries` + `-DontStopIfGoingOnBatteries` | on a laptop, Task Scheduler stops the host the moment the charger is unplugged |
| `-ExecutionTimeLimit ([TimeSpan]::Zero)` | the default limit is 72 hours, so Windows kills the host after three days of uptime |

V4's first installer omitted both. It was fixed by copying V1's choices and adding
`-StartWhenAvailable` plus restart-on-failure, which V1 does not have.
`test/v4/windows-installer.test.js` now fails if either setting disappears, and it
also asserts that V4's task name does not collide with V1's.

Not reused: V1 also writes Start-menu and Desktop shortcuts and copies a payload
into `%LOCALAPPDATA%`; V4 runs from its own checkout and only needs a launcher.

## 3.2 Diagnostics: why V4 has its own doctor

`src/v2/ops/doctor.js` is real but V2-specific — its ten checks cover
`bin/majin-v2.mjs`, the OpenCode key, the GUI runner, whisper and the Studio port.
None of those exist in V4. `scripts/v4/host-doctor.mjs` therefore checks the V4
surface: Node floor, data dir, workspace, HMAC key, pairing record, the V1 config
it reads models from, public origin and proxy trust.

## 4. Limitations found in reused code (not modified)

Reusing a module means inheriting its edges. These were found while wiring V4 to
the V2 voice lane; V2 is left untouched so `v2/main` keeps behaving exactly as
its users expect.

| Module | Limitation | V4 handling |
|---|---|---|
| `src/v2/voice/stt.js` `CommandSttProvider` | strips quotes from **arguments** but uses the executable token verbatim, so a quoted binary path becomes `spawn "C:\Program Files\…" ENOENT` | documented here; V4 tests use an unquoted path and the docs tell operators to use a path without spaces |
| `src/v2/safety/command-preflight.js` | classifies a `|` pipeline as `hold`, not `no` | safe-exec then refuses the pipeline at tokenise time; V4 surfaces `PERMISSION_DENIED`, and a test proves the pipeline never runs |
| `src/v2/tools/runner.js` | throws classified `ToolError`s instead of returning `{ok:false}` | the agent catches them, moves the goal out of `WAITING_FOR_TOOL` and records a failure receipt |
| `src/core/provider/catalog.js` | paginates up to 100 pages with no total cap | V4 bounds the whole call with an 8 s timeout and caches for 6 h |
| `src/v2/runtime/goal.js` | `uncoveredAcceptance()` treats any historical verified receipt as coverage | V4 resume ignores history and re-verifies every item against recorded hashes |

## 4. Risks carried forward

1. V1 config schema is not versioned; a future V1 change could alter
   `providers`/`models.routes`. `models.js` reads defensively and degrades to demo.
2. V2 voice providers need host binaries (whisper/piper). They are not wired to
   the browser, so voice is browser-native only for now.
3. No Windows host is available in this environment: every Windows claim is
   therefore `NOT_STARTED` or `BLOCKED` in the matrix, never assumed.
