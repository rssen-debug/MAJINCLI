# MAJIN V4 — test evidence

All commands were run in this workspace. Nothing below is a plan; each block is a
result that was actually observed.

## Environment

```
Node v22.22.3 · npm 10.9.8 · Linux x86_64 sandbox
Host: no Windows machine, no public tunnel, no model credentials
```

Consequence: every Windows- or device-dependent criterion is `NOT_STARTED` or
`BLOCKED` in the matrix. No Playwright browser binary is available here, so
UI verification is static-contract plus real HTTP asset tests, not screenshots.

## 1. V4 suite

```
$ npm run v4:test
# tests 126
# pass 126
# fail 0
# skipped 0
```

| File | Tests | Covers |
|---|---:|---|
| `test/v4/security.test.js` | 22 | pairing, sessions, expiry, revocation, CSRF, origin, host allowlist, rate limit, body caps, CSP, traversal, overwrite, static escape |
| `test/v4/conversation.test.js` | 12 | streaming, persistence, idempotent replay, cancellation, scoping, deletion, goal states, receipts with SHA-256, crash reconciliation |
| `test/v4/models.test.js` | 16 | V1 config discovery, V1 live catalog reuse, cache TTL, timeout, secret-free projection, unknown model refusal, per-conversation scope, broken config, demo labelling |
| `test/v4/ui.test.js` | 12 | manifest/icons, safe areas, responsive, a11y, SW policy, asset content types, voice policy units |
| `test/v4/kernel.test.js` | 10 | manifest validation, declared permissions, rollback, opt-in, allowlist, flags |
| `test/v4/progress.test.js` | 9 | matrix structure, weights = 100, evidence required, derived score, PROGRESS.md agreement |
| `test/v4/sandbox.test.js` | 9 | env stripping, child-process tools, crash/hang containment, quarantine, permission refusal, honest tool errors |
| `test/v4/resume.test.js` | 9 | resume against recorded hashes, deleted/tampered artifacts stay BLOCKED, correction lineage, cross-device read |
| `test/v4/agent-failures.test.js` | 9 | throwing/schema-breaking/hanging tools, budget stop, strict-policy pause, prompt-injection corpus |
| `test/v4/benchmark.test.js` | 3 | benchmark pass rate, duplicate replay, refusal is FAILED |
| `test/v4/client.test.js` | 9 | conversation continuity across turns, delta assembly, tool card states, replay, cancellation, SSE parser edge cases |
| `test/v4/voice-server.test.js` | 6 | auth/CSRF, verified WAV from the V2 lane, temp cleanup, input limits, honest capability report |

## 2. Repository gates

```
$ npm run check
490/490 files parse cleanly.

$ npm run i18n
0 Swedish string literal(s) in 261 files

$ npm run v4:progress --check
67.5/100 verified points, matrix valid (exit 0)
```

## 3. Live smoke (manual, observed)

```
$ MAJIN_HOME=/tmp/majin-v4-smoke npm run v4 -- --port 7399
  MAJIN V4 / lyssnar http://127.0.0.1:7399 / modell Demo

$ curl -s localhost:7399/api/health     → 200 {"ok":true,"app":"majin"}
$ curl -s localhost:7399/api/state      → 401 UNAUTHORIZED (no session)
$ curl -s localhost:7399/              → 200 text/html (7.6 kB)

POST /api/auth/pair  (valid code)      → 200 + Set-Cookie: HttpOnly; SameSite=Strict
POST /api/chat  "Skriv filen valkomst.txt med innehåll: Hej från MAJIN"
  → tool_start workspace_write → tool_result {ok:true, verified:true}
  → goal COMPLETED, receipt sha256 44e095c7…, 26 bytes on disk
```

## 3.1 Bugs the tests found (fixed, not hidden)

| Bug | How it was caught | Fix |
|---|---|---|
| UI dropped the server's conversation id → every message started a new conversation | `client.test.js` driving real SSE bytes through the client model | client state extracted to `src/v4/ui/session.js`, server is authoritative for the id |
| Resume compared a file against its own hash → tampering was undetectable | `resume.test.js` | compare against the SHA-256 recorded when the work was done |
| Approval wait skipped a legal state hop → goal stuck in WAITING_FOR_TOOL | `agent-failures.test.js` | explicit RUNNING → WAITING_FOR_APPROVAL |
| A turn could end COMPLETED after an unrecovered tool failure | `agent-failures.test.js` | last tool outcome gates completion |
| CRLF-separated SSE stalled the client parser | `client.test.js` | line endings normalised before framing |

## 4. What is NOT tested here

| Claim | Why not | Where it is tracked |
|---|---|---|
| Real model inference | no provider key/endpoint | matrix `A7` (BLOCKED) |
| iPhone/Android device run | no device | matrix `M10`, `H4` |
| Playwright viewport screenshots | no browser binary in sandbox | matrix `M11` |
| Windows logon task + restart persistence | no Windows host | matrix `H1`, `H2`, `H5` |
| Tunnel HTTPS URL | owner action required | matrix `H3` |
| Voice latency / barge-in | no device, browser-only voice | matrix `V6` |

Reproduce locally:

```
npm ci
npm run v4:test
npm run v4:progress
npm run v4:doctor
npm run v4
```
