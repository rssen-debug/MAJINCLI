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
# tests 204
# pass 203
# skipped 1
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
| `test/v4/voice-server.test.js` | 13 | auth/CSRF, verified WAV from the V2 lane, temp cleanup, input limits, honest capabilities, a **real local subprocess** for TTS and STT, pipeline refusal, missing-binary failure |
| `test/v4/turns.test.js` | 9 | sequence ids, replay from a cursor, bounded buffer, reattach after a dropped socket, work survives a hang-up |
| `test/v4/e2e.browser.test.js` | 0 run | real-browser acceptance on 5 viewports — **skips** here, no browser binary (see below) |
| `test/v4/supervisor.test.js` | 6 | real child process: healthy start, crash → restart, crash loop gives up loudly, never-healthy host, health-failure restart, window expiry |
| `test/v4/accept.test.js` | 4 | the acceptance runner reports every real gate, refuses to claim a model without one, and its exit code follows the failures |
| `test/v4/backup.test.js` | 11 | round trip of a real data dir, tampering, missing/unlisted files, key leakage, unknown schema refused, dry run, overwrite refusal, version guard |
| `test/v4/upgrade.test.js` | 8 | clean upgrade, up-to-date, rollback on a failed gate, escalation when rollback fails, fetch/checkout classification |
| `test/v4/leaks.test.js` | 7 | bounded rate limiter and conversation cache, cache eviction loses nothing, bounded listing, abort-key collision, truncated replay |
| `test/v4/leaks2.test.js` | 3 | bounded goal cache, evicted goals reload from disk intact, in-flight goals are never evicted |
| `test/v4/windows-installer.test.js` | 9 | the Windows task runs on battery, has no 72-hour limit, restarts on failure, changes nothing machine-wide, has a clean uninstall, refuses old Node, and does not collide with V1's task |
| `test/v4/client-dom.test.js` | 9 | **the real `app.js` executed in a real DOM (jsdom)** against a real host: boots and shows the gate, pairs, sends a message, renders a verified tool card, keeps one conversation across two messages, restores the composer, and the three failure paths — unreachable host, expired session, and a connection lost *after* `open` that is picked back up with the real answer |

## 2. Repository gates

```
$ npm run check
506/506 files parse cleanly.

$ npm run i18n
0 Swedish string literal(s) in 270 files

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
| Rate limiter grew one permanent entry per client address, forever | `leaks.test.js` | per-window sweep + hard cap of 10 000 buckets |
| Conversation cache kept every conversation in memory for the process lifetime | `leaks.test.js` | LRU with 200 entries; the file on disk is the truth |
| `list()` scanned and returned every conversation file | `leaks.test.js` | bounded to the 100 most recent |
| First message of two devices shared the abort key `'new'`, so one cancelled the other | `leaks.test.js` | one unique key per turn; a known conversation still supersedes its own turn |
| Pressing stop no longer stopped the turn (the journal made it outlive the socket) | `turns.test.js` | stop sends `turnId` to `/api/cancel`; the API accepts a turn id or a conversation id |
| A repeated request whose answer had been truncated replayed an empty message | `leaks.test.js` | explicit `already_handled` status instead of a blank answer; tools still never re-run |
| The goal store kept every goal object in memory for the process lifetime | `leaks2.test.js` | bounded cache that only evicts goals which are not actively executing |

## 3.2 Browser attempt, documented

Three routes were tried for a real browser and all failed for environmental reasons:

1. `@sparticuz/chromium` (npm) — binary extracts fine but links `libnss3` with `NSS_3.30`.
2. `kaleido==0.2.1` (pypi) — bundles Chromium **and** NSS, but its NSS is 3.9 and its binary
   rejects any argv that is not its own scope JSON.
3. `electron` (npm → GitHub releases) — the downloader fails TLS verification, and the release
   asset redirects to `objects.githubusercontent.com`, which is blocked.

The portable test therefore skips with a clear reason and the exact command to run it
elsewhere. That is the honest outcome; a screenshot from a phone is not something this
sandbox can produce.

## 3.3 Acceptance runner output (this machine, demo lane)

```
$ npm run v4:accept
  PASS  host.health                  200 4.0.0-alpha
  PASS  auth.refuses_anonymous       unauthenticated /api/state -> 401
  PASS  auth.pairing_works           pair -> 200
  PASS  auth.cookie_hardened         Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000
  PASS  auth.csrf_required           chat without CSRF -> 403
  PASS  auth.cross_origin_refused    cross-origin -> 403
  PASS  chat.streams                 19 events in 72ms
  PASS  goal.tool_verified           tool result carried verified:true
  PASS  chat.completes               status completed
  PASS  goal.file_on_disk            "acceptanskörning"
  PASS  chat.conversation_id         conv_…
  PASS  persist.conversation_reloads 2 messages
  PASS  restart.goal_survives        1 goal(s) after restart
  PASS  restart.file_survives        <tmp>/workspace/accept.txt
  FAIL  model.configured             no provider configured (running the demo brain)
  PASS  tunnel.skipped               no --url given; public access not checked
  15/16 checks passed — exit 1
```

That `FAIL` is the honest state of the model lane here, and it is why `A7` keeps its
`BLOCKED` status.

## 4. What is NOT tested here

| Claim | Why not | Where it is tracked |
|---|---|---|
| Real model inference | no provider key/endpoint | matrix `A7` (BLOCKED) |
| iPhone/Android device run | no device | matrix `M10`, `H4` |
| Real-browser viewport/visual regression (layout, paint, touch) | no browser binary can be obtained here (CDN, Google storage and objects.githubusercontent are blocked; npm Chromium needs NSS ≥ 3.30) | matrix `M11`, `npm run v4:e2e` on the host |
| The client's *behaviour* (boot, pairing, send, render, conversation continuity) | — **now tested** — `test/v4/client-dom.test.js` runs the shipped `app.js` in jsdom against a real host; what it cannot prove is layout and paint | — |
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
