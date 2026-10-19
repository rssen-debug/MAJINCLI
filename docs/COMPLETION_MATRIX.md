# MAJIN — GRAND ARCHITECT COMPLETION MATRIX

**Contract:** 100 acceptance points across 12 phases (see the 100% Completion Directive).
**Scoring rule:** a test earns its points only when the whole observable behavior is proven,
in code, on current `main`. UNVERIFIED = 0. A regression revokes previously earned points.
**Honesty rule:** no percentages by feeling. Every row carries evidence + a reproduction command.

**Score so far: 56 / 100** (verified against main (squash), v0.6.3-rc, 2026-10-19).

| Phase | Max | Earned |
|---|---:|---:|
| 1. Persistent Sessions & Handoff | 10 | 8 |
| 2. Grand Architect | 12 | 12 |
| 3. HYPERSWARM | 10 | 8 |
| 4. Reality Engine | 16 | 12 |
| 5. Browser & Computer Use | 10 | 2 |
| 6. GENESIS ZERO & Cost | 9 | 3 |
| 7. Skill Compiler | 8 | 2 |
| 8. UI & Imagination | 8 | 0 |
| 9. Real-World Workflows | 5 | 4 |
| 10. Security & Privacy | 5 | 3 |
| 11. Windows & Updates | 4 | 2 |
| 12. Final Acceptance | 3 | 0 |
| **TOTAL** | **100** | **56** |

---

## DEL 1 — Persistent Sessions & Agent Handoff (6/10)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 1A | 2 | Session history persists on disk and sessions never leak into each other | `node --test test/handoff.test.js` — test 1 ("history reaches the model") green, test 2 ("isolation") green; `<sid>.jsonl` on disk | mock provider, linux | `7d04b63` | PASS | 2026-10-18 |
| 1B | 2 | Model/agent switch mid-conversation preserves goal+plan+context | test/handoff.test.js test 3 green; `consumeHandoff` injects `<sid>.handoff.json` once | mock | `7d04b63` | PASS | 2026-10-18 |
| 1C | 2 | Full runtime restart restores conversation, plan and checkpoint artifacts | test/handoff.test.js test 4 green; `<sid>.plan.json` loaded by a fresh runtime | mock, cold restart | `7d04b63` | PASS | 2026-10-18 |
| 1D | 2 | Interrupted work resumes without duplicate side effects; uncertain outcomes are externally inspected first; explicit Resume/Retry/Cancel/Start Fresh | `node --test test/resume.test.js` — 6/6: crash mid-plan (s1 not re-written), crash-in-write-window (evidence closes journal gap), corrupted outcome never accepted (sabotage-proven red), cancel/startFresh semantics, plus a WIRED end-to-end turn whose fs.write lands in the journal with the true sha256 | mock + real runtime loop | main after PR #39 | PASS | 2026-10-18 |
| 1E | 2 | Live handoff between two different real providers (DeepSeek→Qwen →OpenCode→Ollama) | Only one real provider ran live so far (opencode Go free); two-provider switch not executed | needs 2 live providers | — | UNVERIFIED | 2026-10-18 |

## DEL 2 — Grand Architect (12/12) ✅ COMPLETE

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 2A | 3 | Diverse natural-language missions pass predefined interpretation checks (Swe+Eng, numbered, inline, semicolon, informal) | `node --test test/mission.test.js` — tests 1, 6, 7 green (numbered multiline, inline `(1)…`, comma/semicolon, GENESIS ZERO) | mock | `4233339` → `a0a08b0` | PASS | 2026-10-18 |
| 2B | 3 | Dependency graphs and execution order validated | mission.test.js test 2 (cycles, max nodes, damaged deps rejected); `test/swarm.test.js` 10/10 (DAG order) | mock | `933a982` | PASS | 2026-10-18 |
| 2C | 3 | Ambiguity, change and failure-driven replanning work | Three mechanisms in `src/core/mission.js`, all bounded by config and all carrying markers: (1) **Clarify path** — compile prompt may answer `{"clarify":"..."}` → `kind: clarify` with ZERO workers and ZERO side effects (workspace asserted empty); (2) **failure-driven replan** — when repairRounds exhaust with dead contracts, one bounded strategy-change attempt (`mission.limits.replanRounds`, default 1 clamp 0..2) runs with a different-method prompt, charged to the same budget, re-verified against the SAME contracts → success marked `after replan`, failure marked `[LIMIT:REPLAN]`; (3) **objective change mid-flight** — `carry` grafts previously VERIFIED parts by node id: zero re-runs, zero repeated side effects, summary says `carried from previous objective`. task calls counted through every path. `test/mission.test.js` 20/20 (t17–t20). Discrimination: clarify ignored → t17 red; replan dead → t13+t18 red; carry bypassed → t20 red; knob ignored → t13+t19 red. Honest cost note: the clarify compile-rule adds ≈1 estimated token per compile call (bench 24399→24400 measured). | mock | PR #44 | PASS | 2026-10-19 |
| 2D | 3 | Real end-to-end complex goals through the normal chat path | `node /home/user/live-verify-oc.mjs <key>` — mission compiled, 2 workers, files written and `[VERIFIED: …]` in summary | opencode Go free (longcat) | `a0a08b0` | PASS | 2026-10-18 |

## DEL 3 — HYPERSWARM (8/10)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 3A | 2 | Deterministic worker selection (1..N by deps/overhead/costs) | `test/swarm.test.js` — analyzer picks 3 for 3 independent jobs, 1 for a chain, 1 when overhead eats the win | mock | `933a982` | PASS | 2026-10-18 |
| 3B | 2 | Independent work overlaps; dependencies never violated | swarm.test.js + mission.test 4; live mission events `worker_start×N` before completions | mock + opencode live | `a0a08b0` | PASS | 2026-10-18 |
| 3C | 2 | Failure, cancellation and recovery correct (bounded transient recovery, safe replacement) | Scheduler-level bounded replacement in `runSwarm` (`maxAttempts`, per-node attempt counter): `isTransientFailure` admits ONLY network/rate-limit/5xx shapes — permanent errors run EXACTLY ONCE. Replacement = fresh subagent session (`:a2` suffix, no state bleed), every attempt emits `worker_retry(id, attempt, why)`. Hidden retry layers removed for missions: `providerRetries:0` + `providerErrorCap:0` in swarm workers (chat path keeps its defaults), so mission recovery has exactly ONE accountable owner and ZERO sleep hiding. `test/swarm.test.js` t11–t13 + `test/mission.test.js` t16: ECONNRESET flake → replacement → mission still verifies (worker_start→error→worker_retry→worker_start event chain); permanent refusal → calls==1 + dep blocked; AbortSignal mid-flight → zero new starts, all `blocked: cancelled`, wall ≪ serial. Discrimination: everything-transient→t12 red, retry branch off→t11+t16 red, hidden retries restored→t16 red. | mock | PR #43 | PASS | 2026-10-19 |
| 3D | 2 | Parallel work cannot corrupt shared resources (locks, worktrees, ownership) | Adversarial harness in `test/swarm.test.js` t14–t15: ownership timing proven deterministically (workerB queues ≥60 ms behind holder, FIFO order, owner re-entry without deadlock, heldBy empty after release); 2 hostile workers × 5 rounds of interleaved `fs.patch` read-modify-writes on ONE file → every update of BOTH workers present, every line regex-intact (no torn bytes). The lock is the explanation, not luck: bypassing `locked()` turns t15 red (lost update). | mock | PR #43 | PASS | 2026-10-19 |
| 3E | 2 | Real model runs show measurable benefit where parallelism applies | BLOCKED in sandbox: no live provider key exists on this machine (all provider apiKeys empty, no OPENCODE/DEEPSEEK env, ollama wiped by snapshot). In-process wall-clock overlap proof exists (swarm.test "tre oberoende noder verkligen överlappar") but is not a REAL MODEL benchmark — by §16 honesty rules this row stays UNVERIFIED until a live parallel-vs-sequential measurement runs. | — | — | UNVERIFIED (blocked: needs live key) | 2026-10-19 |

## DEL 4 — Reality Engine (12/16)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 4A | 4 | Explicit verification contracts + evidence provenance | Contract engine in `src/core/mission.js`: `buildContracts` derives typed contracts from the mission brief (`file_exists` — stat>0 + sha256[:8], path-escape guarded; `file_contains` — `readFileSync.includes(needle)` on REAL content; `count` — independent `fs.readdir` recount compared against the worker's "N files" claim). `verifyContract` checks CODE-side, never by asking a second model. Dead contracts force a repair round naming the dead contracts; parts only ship when contracts re-verify. Summary carries provenance: `[VERIFIED: store/ has 3 files (independently counted), after repair]`. `test/mission.test.js` 12/12 — t10 content-lie caught, t11 count-lie caught, t12 honest count → no repair. Discrimination: skipping the recount turns ONLY t11 red; rubber-stamping `includes()` turns ONLY t10 red. | mock | PR #40 | PASS | 2026-10-18 |
| 4B | 4 | Detect and repair intentionally introduced failures | `test/mission.test.js` 20/20 — lying workers detected, one repair round turns a fake write into a real `fs.write`; fail-first proven on pre-fix code | mock | `a0a08b0` | PASS | 2026-10-18 |
| 4C | 4 | Retry/budget/timeout/approval limits respected | One policy object `missionLimits(cfg)` (defaults in config.js: repairRounds 1 / timeoutMs 0 / tokenBudget 0, hard clamps 0..3 / 3600000 / 1e9) enforced in CODE in `runMission`: budgetedWorker charges real measured usage per worker and aborts the swarm past the cap (verify→repair included), AbortController+deadline reach runSwarm, repair loop is `rounds < repairRounds` and fails HONESTLY with markers — `[LIMIT:RETRY]` / `[LIMIT:BUDGET]` / `[LIMIT:TIMEOUT]` named in the mission summary, return object carries `limits`/`limitsHit`/`usedTokens`. `test/mission.test.js` t13–t15 (15/15): permanently-lying worker runs EXACTLY 1+1+2 worker-calls (counted via mock `calls`, not asserted from prose), token cap 40 stops worker #2 from ever starting, 120 ms wall budget cuts a ~1.7 s mock stream. Discrimination: budget gate off → t14 red; rounds +96 → t13 red; deadline/signal pass-through removed → t15 red (bench proof the caps are free when idle: identical 24399 tokens / 22 calls 7/7). Side-effect approvals remain governed by guard/exec policy (tests in test/guard*). | mock | PR #41 | PASS | 2026-10-19 |
| 4D | 4 | Real cross-domain tasks with independently checked results | Only the file domain verified live so far | opencode live | — | UNVERIFIED (1 domain) | 2026-10-18 |

## DEL 5 — Browser & Computer Use (2/10)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 5A | 2 | Forms and interactive controls | — | needs real browser | — | UNVERIFIED | 2026-10-18 |
| 5B | 2 | Dynamic navigation, tabs, iframes | `test/browser.test.js` covers wire discovery only | — | — | UNVERIFIED | 2026-10-18 |
| 5C | 2 | Observation and bounded recovery (no blind click loops) | `node --test test/browser.test.js` — LoopJournal stops 3 identical actions cold; slot pool queues; session isolation | node, no browser | main line | PASS | 2026-10-18 |
| 5D | 2 | Real Windows computer-use scenarios | — | needs Windows runner | — | UNVERIFIED | 2026-10-18 |
| 5E | 2 | Multi-step real website workflow without unverified completion claims | `jobs.test.js` has form-fill state machine; live probe gated | — | — | UNVERIFIED | 2026-10-18 |

## DEL 6 — GENESIS ZERO & Cost (3/9)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 6A | 3 | Real per-task usage + strict budget enforcement | Usage is recorded (`usage.js`), but there is no enforced per-task/monthly cap; "unknown price must not read as zero" untested | — | — | UNVERIFIED | 2026-10-18 |
| 6B | 3 | Model profiling, routing + single-model guarantee | `test/singlemodel.test.js` 3/3 (one chosen model covers all routes, MOA off); `test/subset.test.js` tool-subset selection | mock | main line | PASS | 2026-10-18 |
| 6C | 3 | Comparable verified quality at lower measured cost | Free opencode models verified tasks at $0, but no same-task matrix vs other models | opencode free | — | UNVERIFIED | 2026-10-18 |

## DEL 7 — Skill Compiler (2/8)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 7A | 2 | Capability discovery + missing-capability detection | `test/capability.test.js` 7/7; `test/github-research.test.js` 4/4 | mock/github API gated | main line | PASS | 2026-10-18 |
| 7B | 2 | Safe adapter creation + validation (schemas, permission classes) | — | — | — | UNVERIFIED | 2026-10-18 |
| 7C | 2 | Verified reusable skills w/ failure tracking and disable-on-repeat-fail | Skill system exists; no failure-tracking acceptance test | — | — | UNVERIFIED | 2026-10-18 |
| 7D | 2 | End-to-end new capability through the existing engine | Jobs/Teamtailor adapters were hand-built, not skill-compiled | — | — | UNVERIFIED | 2026-10-18 |

## DEL 8 — One-Chat UI & Imagination (0/8)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 8A | 2 | Onboarding + model switching in the real interface | `test/onboarding.test.js` 7/7 prove endpoint-level onboarding; **no model switch action in the chat UI** (gap also required by Del 1) | — | — | UNVERIFIED | 2026-10-18 |
| 8B | 2 | Task cards reflect real backend state | `test/one-chat-ux.test.js` 3/3 exists; not mapped to live worker cards | — | — | UNVERIFIED | 2026-10-18 |
| 8C | 2 | Living Canvas + safe previews with real artifacts | `test/imagination.test.js` 4/4; `test/imagination-preview.test.js` — declarative rendering rules; living-canvas pass not formally run | — | — | UNVERIFIED | 2026-10-18 |
| 8D | 2 | Accessibility/performance/interaction tests | No a11y suite | — | — | UNVERIFIED | 2026-10-18 |

## DEL 9 — Real-World Workflows (4/5)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 9A | 1 | Job workflow real test evidence + explicit approval before submit | `test/jobs.test.js` 13/13 (state machine, dedupe, CV-match, Platsbanken parser, approval-boundary) + gated live probe | offline + gated live | main line | PASS | 2026-10-18 |
| 9B | 1 | Marketing workflow evidence + no publish without permission | `test/marketing.test.js` 10/10 (+ `marketing-plan.test.js`, `marketing-channels.test.js`) | mock | main line | PASS | 2026-10-18 |
| 9C | 1 | Coding/research workflow evidence | `test/re.test.js` 8/8 ("RE-spec between understanding and rebuild, with proof per claim"); github tools against real API gated | mock | main line | PASS | 2026-10-18 |
| 9D | 1 | Creative/productivity workflow evidence | File tools proven incidentally; no dedicated creative workflow test | — | — | UNVERIFIED | 2026-10-18 |
| 9E | 1 | Financial research / paper trading with costs + no profit promises | `test/trading.test.js` 7/7 | mock | main line | PASS | 2026-10-18 |

## DEL 10 — Security & Privacy (3/5)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 10A | 1 | Permissions and approval enforcement | bench scenario `guard-approval` green; approvals gate in `src/core/guard.js` | bench (mock) | main line | PASS | 2026-10-18 |
| 10B | 1 | Secret protection and privacy | `test/provider-flow.test.js` — saved key never echoed; `cfg.redacted()` masks | — | `cc604d2` | PASS | 2026-10-18 |
| 10C | 1 | Prompt-injection resistance (web/repo/doc) | No adversarial injection suite | — | — | UNVERIFIED | 2026-10-18 |
| 10D | 1 | Process/file isolation + cancellations actually stop work | `test/readonly.test.js` 6/6 (read-only turns cannot touch); workspace escape refusal in `resolveIn` | mock | main line | PASS | 2026-10-18 |
| 10E | 1 | Real adversarial regression tests | `test/stability.test.js` 15/15 exists; not classified adversarial | — | — | UNVERIFIED | 2026-10-18 |

## DEL 11 — Windows Installer, Updates & Delivery (2/4)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 11A | 1 | Clean Windows install + first run | `test/installer.test.js` 12/12 (Inno/shortcut config); a real clean Windows box has not run the flow | needs Windows | — | UNVERIFIED | 2026-10-18 |
| 11B | 1 | Old-version→new-version update path | `node verify-update.mjs` → status `available`, notice + correct asset + sha256 asset against the live release v0.5.7/v0.5.8 | linux, live GitHub | v0.5.5-line | PASS | 2026-10-18 |
| 11C | 1 | Data preservation + failure recovery across updates | No test runs an old config/session set through an upgrade | — | — | UNVERIFIED | 2026-10-18 |
| 11D | 1 | Verified release artifacts (checksum + integrity) + no asset/tag overwrite | v0.5.6/0.5.7/0.5.8: 4 assets each (EXE + installer + 2×.sha256), HEAD-200 downloads, `release-safety.test.js` guards | GitHub API | `2c5f308` | PASS | 2026-10-18 |

## DEL 12 — Final Real-World Acceptance (0/3)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 12A | 1 | Independent real-model end-to-end acceptance suite | This matrix + a versioned additive acceptance runner are new; suite not yet runnable | — | — | UNVERIFIED | 2026-10-18 |
| 12B | 1 | Real Windows user-journey + recovery suite | — | needs Windows | — | UNVERIFIED | 2026-10-18 |
| 12C | 1 | Release candidate passes all mandatory integration gates | — | — | — | UNVERIFIED | 2026-10-18 |

---

## Current frontier (what the next runs attack, in order)

1. ~~Del 1D~~ ✅ PASS (PR #39). Next: 4A/4C verification contract types + hard limits.
2. **Del 4A+4C (8 pts)** — verification contract types beyond files (number/text/content claims), retry/budget/timeout caps as enforced acceptance behavior.
3. **Del 3C/3D/3E (6 pts)** — transient-recovery + corruption-adversarial tests + parallel-vs-sequential measured benefit.
4. **Del 2C (3 pts)** — ambiguity clarifying questions + failure-driven replanning.
5. **Del 1E (2 pts)** — live two-provider handoff (opencode + ollama local).

A regression in any PASS row revokes the points until re-proven on `main`.
