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
| Config + data dirs | `src/core/config.js`, `paths.js` | proven | path rules re-implemented narrowly; config file read as-is |
| Persona / style | `src/core/config.js` `persona` | text only | replaced by a V4 system prompt (mobile product voice) |
| Agent loop | `src/core/agent.js` (674 lines) | usable | **not reused**: it is CLI/desktop oriented and would drag the whole surface in |
| Tools | `src/core/tools/*`, shell/fs/browser | usable | not reused; V4 exposes a minimal typed workspace surface |
| Memory | `src/core/memory.js` | usable | V2 store preferred (cleaner contract) |
| Voice | V1 channels/voice are UI-bound | scaffold | not reused in the browser client |
| Windows install / startup | `install.ps1`, `start-majin.cmd` | usable | pattern reused; V4 gets its own per-user task |

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

## 3. Duplication ledger

| Built in V4 | Why not reuse |
|---|---|
| `security.js` (limits, host/origin) | V3's checks are one-shot and loopback-only; needed reusable, tested middleware |
| `store.js` (conversations) | No conversation persistence exists in V1–V3 |
| `models.js` (discovery) | V1 has a registry but no safe, secret-free projection for a remote client |
| `kernel.js` | No versioned capability contract exists in any prior version |
| `ui/*` | No mobile/PWA surface exists |

## 4. Risks carried forward

1. V1 config schema is not versioned; a future V1 change could alter
   `providers`/`models.routes`. `models.js` reads defensively and degrades to demo.
2. V2 voice providers need host binaries (whisper/piper). They are not wired to
   the browser, so voice is browser-native only for now.
3. No Windows host is available in this environment: every Windows claim is
   therefore `NOT_STARTED` or `BLOCKED` in the matrix, never assumed.
