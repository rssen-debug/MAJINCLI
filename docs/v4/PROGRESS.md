# MAJIN V4 — verified progress

**As of:** 2026-10-22 (Europe/Stockholm)
**Branch:** `v4/main` · **Base:** V3 `df678b2`
**Release status:** **NOT READY** — private vertical slice works, no verified public URL.
**Score source of truth:** `npm run v4:progress` (recomputed from `ACCEPTANCE_MATRIX.json`, never hand-written)

## Score

- **Verified:** **78.5/100** points (**78.5%**)
- **Criteria:** 75 → 62 VERIFIED · 1 PARTIAL · 9 NOT_STARTED · 3 BLOCKED

| Area | Earned | Weight | What is actually proven |
|---|---:|---:|---|
| BASELINE | 4 | 4 | refs recorded, protected branches untouched, no secrets, matrix validated by code |
| MOBILE | 9.5 | 12 | manifest + icons, safe areas, responsive, reduced motion, 42px targets, SW shell-only, model picker |
| SECURITY | 13 | 14 | pairing, sessions, revocation, CSRF, origin/host, rate limits, CSP, traversal, no keys to client |
| CONVERSATION | 9 | 9 | streaming, persistence, idempotent retry, cancellation, scoping, deletion, honest errors, corrections linked as revisions, cross-device read |
| GOALS | 12 | 14 | V2 state machine, SHA-256 verification, receipts, crash→BLOCKED, resume re-verifies against recorded hashes, tool failures classified |
| MODELS | 12 | 14 | V1 config reuse, V1 live catalog discovery (TTL cache + refresh), no secrets, id scoping, demo degradation |
| VOICE | 7 | 9 | honest capability model, language, error copy, auto-send rules, speech text |
| PLATFORM | 12 | 12 | versioned kernel, manifest validation, rollback, opt-in + allowlist + flags |
| HOST | 0 | 12 | nothing verified — no Windows host and no tunnel in this environment |

## What works right now (evidence-backed)

1. A phone-sized browser can pair with a code, receive a session and hold a conversation.
2. A real turn streams over SSE, executes typed tools and verifies file writes on disk (SHA-256).
3. Conversation history, goals and receipts persist to disk and survive a restart.
4. A repeated `requestId` is replayed instead of executing twice (safe reconnects).
5. Cancellation aborts the active turn and records `CANCELLED`.
6. `GET /api/models` lists the models from the existing Windows MAJIN config, with no key material, and
   `?refresh=1` runs V1's live provider catalog (pagination, auth, origin pinning) behind a 6 h cache.
7. Model choice is scoped to one conversation and validated server-side.
8. Without a configured provider the app runs a labelled demo brain — it cannot pretend to be an LLM.
9. PWA shell is installable (manifest + 192/512/maskable icons) and never caches API data.
10. Plugin kernel validates manifests, enforces declared permissions, rolls back failed activations,
    quarantines a broken plugin with a written reason, and runs plugins in a supervised child
    process with a stripped environment and per-call timeouts.
11. Resume of a BLOCKED goal re-verifies every artifact against the hash recorded when it was
    written; a deleted or tampered file keeps the goal BLOCKED instead of "completing".
12. A correction ("nej, ändra X") is recorded as a revision of the previous goal, not an orphan task.
13. A second paired device sees the same conversation and the same goal state.
14. A prompt-injection corpus (path escapes, role tags, huge payloads, reserved names) cannot
    leave the workspace, break a schema or skip approvals.
15. `npm run v4:bench` measures pass rate, p50/p95 latency, tool calls and receipt coverage,
    and detects duplicate-request replay.
16. The browser client keeps the conversation across turns. This was **broken**: the UI dropped
    the conversation id the server returned, so every message started a new thread. The client
    state is now a pure, tested module (`src/v4/ui/session.js`) driven by the same SSE bytes the
    server emits, including CRLF, split chunks and malformed JSON.
17. A BLOCKED goal can be resumed from the phone. The button never promises success: the server
    re-verifies against recorded hashes and can answer "still blocked" with the exact items.
18. Server-side speech is wired through the V2 voice lane. Three lanes are proven: the deterministic
    `buffer` provider (silent WAV, labelled synthetic), a **real local binary** spawned argv-only
    with a scrubbed environment (`command`), and refusal of a shell pipeline in the template.
    STT goes through the same lane and reports an empty transcript as `inconclusive`, never as a
    sentence nobody said. A cloud engine (`edge-tts`) needs network and is not claimed.

## Remaining by area (9 NOT_STARTED + 2 PARTIAL + 3 BLOCKED)

| Area | Points left | What it needs |
|---|---:|---|
| HOST | 12 | the Windows machine, the tunnel and a phone |
| VOICE | 2 | a real device: measured TTS latency and barge-in (V6) |
| MOBILE | 2.5 | physical-device walkthrough, real-browser visual regression, spirit polish |
| GOALS | 2 | multi-step browser goal on the host |
| MODELS | 2 | real inference (blocked: no provider key here) |
| SECURITY | 1 | external penetration test |

## Open blockers

- **H3/H4 (8 points):** no private HTTPS URL and no physical iPhone/Android run. Needs the owner to
  run the tunnel on their Windows PC (`docs/v4/DEPLOYMENT.md`) — credentials/DNS are the owner's.
- **A7 (4 points):** real inference through a configured provider is blocked here: no provider key
  and no outbound network to a model endpoint in this sandbox.
- **H1/H2/H5/H6:** Windows-specific automation (logon task, desktop session limits, restart
  persistence on the real box) is written as scripts but unexecuted on Windows.
- **Voice V6/V7:** no measured TTS latency, no barge-in measurement, no server-side STT/TTS wiring.

## Honest limitations of the demo brain

The demo brain understands a narrow set of file intents (write / list) and otherwise explains that
no model is connected. It is a transport-and-execution harness for real model wiring, not an
assistant. Any progress point that depends on model quality is not claimed.

## Connection survival (new, evidence-backed)

A dropped connection used to abort the turn. On a phone that meant asking again and
losing the work. The turn now runs independently of the HTTP response and is recorded in a
bounded journal (`src/v4/turns.js`): every event carries a sequence id, a client can reattach
with `GET /api/chat/stream?turnId=…&from=<lastSeq>`, and the UI retries with backoff.

Proven by `test/v4/turns.test.js` and `test/v4/client.test.js`: the file is written even when the
client hangs up mid-stream, and the reattached client receives the verified tool result and
the terminal status without duplicates.

## The client is now executed, not just inspected

Every earlier UI test read files. `test/v4/client-dom.test.js` loads the shipped `index.html`
into jsdom, points `fetch` at a real MAJIN host, evaluates the same `app.js` that goes to the
phone, and drives it: boot → gate → pairing → type → send → verified tool card → answer, and
two messages that must stay in **one** conversation.

That test would have caught the dropped-conversation-id bug the day it was written. Canvas,
speech and service workers are stubbed (jsdom has none); the application code is not.

The three ways a phone actually fails are covered too:

| Scenario | What the test proves |
|---|---|
| Host unreachable | an honest error appears and the composer works again — no stuck "streaming" state |
| Session expired mid-turn | the pairing gate re-opens with a reason instead of failing silently |
| Connection lost **after** `open` | the client reattaches to the same turn and shows the host's real answer, not a host-failure message, and the work exists exactly once on disk |

jsdom is a devDependency, so this runs in CI instead of being a local curiosity.

## What a real browser would add (and why it is still unearned)

`npm run v4:e2e` contains the acceptance run: five viewports (iPhone 13/SE, Pixel 7, iPad,
desktop), horizontal-overflow checks, 42px touch targets, composer above the fold, pairing,
a real message, a **verified** tool card, console-error check, and screenshots into
`docs/v4/evidence/`. It skips loudly when no browser binary exists.

No browser binary can be obtained in this environment: Playwright's CDN, Google's storage and
`objects.githubusercontent.com` are all unreachable, and the npm-shipped Chromium needs NSS
≥ 3.30 which the image does not have. So M11 stays unearned rather than being replaced by a
claim. On the Windows host: `npx playwright install chromium && npm run v4:e2e`.

## One command that proves (or refuses) the release

`npm run v4:accept` exercises a real host on this machine and prints PASS/FAIL for every
automated gate: health, anonymous access refused, pairing works, cookie is HttpOnly +
SameSite=Strict, CSRF required, cross-origin refused, chat streams, the tool result is
**verified**, the file is on disk with the right bytes, the conversation reloads, and a
**second host process on the same data dir still sees the finished goal**.

Add `-- --url https://your-tunnel` and it also checks the public URL is HTTPS and refuses
anonymous reads. `--write` stores the run under `docs/v4/evidence/`.

The runner cannot flatter the project: it exits non-zero when any check fails, and it reports
`model.configured: FAIL` while no provider is configured — a demo brain is not a model.
Acceptance points are still written by hand, from that output.

`npm run v4:serve:supervised` runs the host under `src/v4/supervisor.js`: health probing every
15 s, restart with exponential backoff, a hard cap so a crash loop fails loudly instead of
spinning, and one JSON line per lifecycle event in
`v4/logs/supervisor-<date>.jsonl`. Tested with real child processes that are killed.

## Keeping the data when the disk dies

`npm run v4:backup -- backup` writes a plain directory bundle with a `MANIFEST.json` and a
SHA-256 per file — the same discipline as V2's audit bundle, and memory is exported through
`MemoryStore.exportAll()`, not a second serializer.

Refusals are the point:

- keys, pairing records and session records are **never** copied; a backup that carried the
  HMAC key would let anyone holding it forge sessions, so a restore means pairing again;
- `verify` re-proves manifest ≡ files and rejects tampering, missing files and unlisted extras;
- `restore` refuses an unknown `schema` instead of guessing — that is the migration check;
- `restore` refuses to overwrite live data without `--force`, and `--dry-run` validates without
  writing a byte.

## Upgrading a release without breaking the running one

`npm run v4:upgrade` fetches, checks out `origin/v4/main`, then runs install → doctor → tests →
matrix. If any gate fails it returns the checkout to the previous commit and reinstalls. A failed
rollback is reported as `ESCALATE`, not swallowed. `-- --dry` shows the plan and touches nothing.

The decision logic is tested with an injected runner, including the rollback path and the
escalation path, so the dangerous branch is exercised before it is ever needed.

## Hardening pass: six defects found by testing the system against itself

No new features in this pass. The target was the failure modes of a host that runs for months.

| Defect | Consequence if shipped | Fix |
|---|---|---|
| Rate limiter never evicted buckets | one permanent entry per client address, for the process lifetime | sweep per window + hard cap |
| Conversation cache never evicted | every conversation stayed in memory | LRU, 200 entries |
| `list()` returned every conversation file | the drawer got slower as history grew | bounded to 100 |
| First message of two devices shared the abort key `'new'` | one device silently cancelled the other | one key per turn |
| Stop no longer stopped the turn | the journal made turns outlive the socket; stop only detached | stop sends the turn id to the server |
| Repeated request after truncation replayed an empty answer | user sees a blank reply labelled "replayed" | explicit `already_handled`, tools never re-run |
| Goal store retained every goal object forever | memory grew with every task ever run | bounded cache; only non-executing goals are evicted |

Each one has a test that failed before the fix. That is the only reason to trust the list.

## Next engineering objective

Wire the tunnel and a real provider on the Windows host, then run the acceptance scenario in
`NEXT_ACTIONS.md` #1 and move HOST points from NOT_STARTED to VERIFIED with captured evidence.
