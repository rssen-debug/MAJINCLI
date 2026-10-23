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
# tests 368
# pass 367
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
| `test/v4/owner-mode.test.js` | 21 | nothing granted by default, grants persist, 0600 file, folder implies files, files inert without a folder, drive roots refused (portable across platforms), inside-only path check, immediate revoke, per-lane revoke, unknown lanes refused, audit history, corrupt file degrades to nothing, live grant/revoke through the API without a restart, grant survives restart |
| `test/v4/skills.test.js` | 15 | shipped skills well formed, withheld without required lanes, withheld without required tools, degraded (not hidden) when a preferred tool is missing, bounded prompt section, malformed skill skipped, directory/name mismatch, oversized body capped, experimental hidden, phone view explains every block, `prefers` never widens access |
| `test/v4/uploads.test.js` | 16 | leaf names, executable types refused, real PNG stored with a hash, lying payloads refused, size enforced, collisions suffixed, `data:` URLs accepted, traversal impossible, sandbox headers for HTML/SVG, session + CSRF required, a photo lands in the workspace, an agent-written page is served sandboxed |
| `test/v4/tool-exposure.test.js` | 8 | a tool registered after startup reaches the model; host tools are offered when enabled; the list is bounded and every entry is valid JSON Schema; an unconvertible schema is skipped; a host tool is actually callable; with host tools ON the model sees >5 tools (the reported bug); with them OFF it sees exactly the workspace five; the capability report and the model list agree |
| `test/v4/host-tools.test.js` | 23 | lane discovery, absent lanes register nothing, tiers drive approval, held shell needs consent, a real file read, allowlist narrowing, structured V1 failures classified, protected-path refusal classified, the `v4:tools` CLI |
| `test/v4/upgrade-git.test.js` | 5 | real `git` with a real bare origin: a clean tree upgrades; uncommitted tracked changes stop it before anything moves; untracked files do not block; a failing gate rolls the real checkout back; an up-to-date repo is a no-op |
| `test/v4/crash.test.js` | 8 | every interrupted state is reconciled through legal hops (WAITING_FOR_TOOL, WAITING_FOR_APPROVAL, RUNNING, VERIFYING, PLANNING), a pre-execution goal is cancelled, a completed goal is untouched, orphaned approvals are cleared, a reconciled goal is resumable, and the boot banner announces it |
| `test/v4/journal-live.test.js` | 6 | a running turn survives the TTL, a finished one expires, ten newer turns do not evict a live one, finished turns are still bounded, a live burst is bounded generously, and a client can reattach to a turn that outlived the TTL |
| `test/v4/timeout.test.js` | 3 | a cooperative tool is told about its deadline and stops before the effect lands; a tool that ignores the signal never earns a success receipt and is recorded as TIMEOUT; a plugin worker is stopped at its call deadline |
| `test/v4/cancel.test.js` | 6 | a long tool receives a signal and stops; a template-ignoring tool still finishes as before; a cancelled turn records CANCELLED with no success receipt; a plugin worker is stopped on abort; logout stops the revoked session's turns and leaves another device running; a revoked session cannot reattach |
| `test/v4/integration.test.js` | 5 | a resumed goal appears in the conversation the user reopens (success and failure); the reopened conversation shows the live goal state; a chosen model survives a reload; telemetry records one row per finish |
| `test/v4/memory.test.js` | 8 | a saved preference reaches the model on the next turn; irrelevant memories are not injected; relevance beats noise; the section is framed as data not instructions; no empty section; a broken store cannot fail a turn; end to end across two conversations |
| `test/v4/telemetry.test.js` | 7 | a real turn records goal.start/model.call/task.result/verification/goal.finish; message text, file names and absolute paths never reach the ledger; the serializer drops unknown fields; unknown event names are refused; aggregate reads V4 data; the CLI summarises and reports "no data"; a broken ledger cannot take a turn down |
| `test/v4/context.test.js` | 8 | history is trimmed to the token budget, the newest message always survives, the system prompt is never trimmed, an oversized message is truncated with a visible marker, and the packer's own edge cases |
| `test/v4/recovery.test.js` | 4 | a flaky read tool recovers; a write tool is attempted exactly once; the retry budget is the advisor's, not a loop; a human-only failure class executes nothing and surfaces the advice |
| `test/v4/cli.test.js` | 11 | the commands the owner types, spawned as real subprocesses: doctor (text + JSON), progress, backup → verify → restore round trip, overwrite refusal, tamper detection, plugin list/quarantine, upgrade --dry, bench, unknown command |
| `test/v4/windows-installer.test.js` | 9 | the Windows task runs on battery, has no 72-hour limit, restarts on failure, changes nothing machine-wide, has a clean uninstall, refuses old Node, and does not collide with V1's task |
| `test/v4/client-dom.test.js` | 9 | **the real `app.js` executed in a real DOM (jsdom)** against a real host: boots and shows the gate, pairs, sends a message, renders a verified tool card, keeps one conversation across two messages, restores the composer, and the three failure paths — unreachable host, expired session, and a connection lost *after* `open` that is picked back up with the real answer |

## 2. Repository gates

```
$ npm run check
506/506 files parse cleanly.

$ npm run i18n
0 Swedish string literal(s) in 278 files

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
| Conversation history was a fixed `slice(-30)` with no token budget, so a long chat could exceed a small model's window and fail the turn | `context.test.js` | budget-aware packing with a visible marker; the newest message and the system prompt always survive |
| The host had no telemetry at all — an always-on box with no logs cannot be debugged | `telemetry.test.js` | V2's ledger wired in: fixed field allowlist per event, so nothing the user typed can land in it |
| Memory was write-only: saved preferences never reached a new conversation | `memory.test.js` | per-turn retrieval injected as a labelled prompt section, bounded and framed as data |
| Resuming a blocked goal left no record in the conversation and no telemetry row | `integration.test.js` | the resume writes a message and a `goal.finish` row; the conversation is resolved from the message that references the goal |
| Cancelling a turn left the running tool working, and its effect landed with no receipt | `cancel.test.js` | the tool receives an AbortSignal through a per-call registry facade; plugin calls stop their worker on abort |
| A tool that overran its deadline kept running and its effect landed after the goal was failed | `timeout.test.js` | the same facade fires on the deadline too; overruns are recorded as TIMEOUT and never as success |
| The turn journal pruned and evicted turns that were still running, so a phone reconnecting to a long turn got 404 | `journal-live.test.js` | only finished turns expire or are evicted; live turns have a separate ceiling |
| Crash reconciliation attempted an illegal `VERIFYING → BLOCKED` hop and swallowed the throw, so VERIFYING and WAITING_FOR_TOOL goals were never recovered | `crash.test.js` | `interruptPath()` uses hops the state machine allows; unreconciled goals are named on the boot banner, orphaned approvals cleared |
| `upgrade` never checked `git status`, so uncommitted work could be carried across or lost | `upgrade-git.test.js` | stops before anything moves, names the files, suggests `git stash`; untracked files are still allowed |
| An `UpgradeError` in the CLI surfaced as an unhandled rejection | `cli.test.js` | printed as `STOPPED (code)` with exit 1 |
| Logging out left the turn running to completion | `cancel.test.js` | turns record their owning session; logout aborts that session's turns |

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
