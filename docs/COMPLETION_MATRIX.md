# MAJIN — GRAND ARCHITECT COMPLETION MATRIX

**Contract:** 100 acceptance points across 12 phases (see the 100% Completion Directive).
**Scoring rule:** a test earns its points only when the whole observable behavior is proven,
in code, on current `main`. UNVERIFIED = 0. A regression revokes previously earned points.
**Honesty rule:** no percentages by feeling. Every row carries evidence + a reproduction command.

**Score so far: 81 / 100** (verified against main `fb12b43` (squash), v0.9.20, 2026-10-20; row-sum == header == phase-sum, CI-locked by w6-matrix-integrity).

| Phase | Max | Earned |
|---|---:|---:|
| 1. Persistent Sessions & Handoff | 10 | 8 |
| 2. Grand Architect | 12 | 12 |
| 3. HYPERSWARM | 10 | 10 |
| 4. Reality Engine | 16 | 16 |
| 5. Browser & Computer Use | 10 | 8 |
| 6. GENESIS ZERO & Cost | 9 | 6 |
| 7. Skill Compiler | 8 | 8 |
| 8. UI & Imagination | 8 | 0 |
| 9. Real-World Workflows | 5 | 5 |
| 10. Security & Privacy | 5 | 5 |
| 11. Windows & Updates | 4 | 2 |
| 12. Final Acceptance | 3 | 1 |
| **TOTAL** | **100** | **81** |

---

## DEL 1 — Persistent Sessions & Agent Handoff (8/10)

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

## DEL 3 — HYPERSWARM (10/10)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 3A | 2 | Deterministic worker selection (1..N by deps/overhead/costs) | `test/swarm.test.js` — analyzer picks 3 for 3 independent jobs, 1 for a chain, 1 when overhead eats the win | mock | `933a982` | PASS | 2026-10-18 |
| 3B | 2 | Independent work overlaps; dependencies never violated | swarm.test.js + mission.test 4; live mission events `worker_start×N` before completions | mock + opencode live | `a0a08b0` | PASS | 2026-10-18 |
| 3C | 2 | Failure, cancellation and recovery correct (bounded transient recovery, safe replacement) | Scheduler-level bounded replacement in `runSwarm` (`maxAttempts`, per-node attempt counter): `isTransientFailure` admits ONLY network/rate-limit/5xx shapes — permanent errors run EXACTLY ONCE. Replacement = fresh subagent session (`:a2` suffix, no state bleed), every attempt emits `worker_retry(id, attempt, why)`. Hidden retry layers removed for missions: `providerRetries:0` + `providerErrorCap:0` in swarm workers (chat path keeps its defaults), so mission recovery has exactly ONE accountable owner and ZERO sleep hiding. `test/swarm.test.js` t11–t13 + `test/mission.test.js` t16: ECONNRESET flake → replacement → mission still verifies (worker_start→error→worker_retry→worker_start event chain); permanent refusal → calls==1 + dep blocked; AbortSignal mid-flight → zero new starts, all `blocked: cancelled`, wall ≪ serial. Discrimination: everything-transient→t12 red, retry branch off→t11+t16 red, hidden retries restored→t16 red. | mock | PR #43 | PASS | 2026-10-19 |
| 3D | 2 | Parallel work cannot corrupt shared resources (locks, worktrees, ownership) | Adversarial harness in `test/swarm.test.js` t14–t15: ownership timing proven deterministically (workerB queues ≥60 ms behind holder, FIFO order, owner re-entry without deadlock, heldBy empty after release); 2 hostile workers × 5 rounds of interleaved `fs.patch` read-modify-writes on ONE file → every update of BOTH workers present, every line regex-intact (no torn bytes). The lock is the explanation, not luck: bypassing `locked()` turns t15 red (lost update). | mock | PR #43 | PASS | 2026-10-19 |
| 3E | 2 | REAL parallel-vs-sequential benchmark (live model) | LIVE MEASURED: scripts/live-bench.mjs through runSwarm, opencode longcat-2.5-preview-free, N=4 briefs, R=3 interleaved — seq median 47 499 ms (overlap 0/0/0) vs par median 11 065 ms (overlap 6/6/6) = **4.29× speedup**; 24/24 ok; 6 290 tokens MEASURED. Test-level live corroboration N=3: 24 522 vs 6 991 ms, tokens 660=660. Table committed in docs/BENCHMARKS.md. | `node scripts/live-bench.mjs` (key required) · `MAJIN_LIVE=1 node --test test/live-bench.test.js` · offline CI path same harness w/o key (370/0/7+1) | mock + live | 2-way discrimination: D1 (cap forced 1 → RED in mock AND live: par behaved seq-equal 30 553 ms/overlap 0), D2 (result timestamps zeroed → overlap evidence breaks, RED), both restored green | **PASS** | 2026-10-19 |

## DEL 4 — Reality Engine (16/16) ✅ COMPLETE

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 4A | 4 | Explicit verification contracts + evidence provenance | Contract engine in `src/core/mission.js`: `buildContracts` derives typed contracts from the mission brief (`file_exists` — stat>0 + sha256[:8], path-escape guarded; `file_contains` — `readFileSync.includes(needle)` on REAL content; `count` — independent `fs.readdir` recount compared against the worker's "N files" claim). `verifyContract` checks CODE-side, never by asking a second model. Dead contracts force a repair round naming the dead contracts; parts only ship when contracts re-verify. Summary carries provenance: `[VERIFIED: store/ has 3 files (independently counted), after repair]`. `test/mission.test.js` 12/12 — t10 content-lie caught, t11 count-lie caught, t12 honest count → no repair. Discrimination: skipping the recount turns ONLY t11 red; rubber-stamping `includes()` turns ONLY t10 red. | mock | PR #40 | PASS | 2026-10-18 |
| 4B | 4 | Detect and repair intentionally introduced failures | `test/mission.test.js` 20/20 — lying workers detected, one repair round turns a fake write into a real `fs.write`; fail-first proven on pre-fix code | mock | `a0a08b0` | PASS | 2026-10-18 |
| 4C | 4 | Retry/budget/timeout/approval limits respected | One policy object `missionLimits(cfg)` (defaults in config.js: repairRounds 1 / timeoutMs 0 / tokenBudget 0, hard clamps 0..3 / 3600000 / 1e9) enforced in CODE in `runMission`: budgetedWorker charges real measured usage per worker and aborts the swarm past the cap (verify→repair included), AbortController+deadline reach runSwarm, repair loop is `rounds < repairRounds` and fails HONESTLY with markers — `[LIMIT:RETRY]` / `[LIMIT:BUDGET]` / `[LIMIT:TIMEOUT]` named in the mission summary, return object carries `limits`/`limitsHit`/`usedTokens`. `test/mission.test.js` t13–t15 (15/15): permanently-lying worker runs EXACTLY 1+1+2 worker-calls (counted via mock `calls`, not asserted from prose), token cap 40 stops worker #2 from ever starting, 120 ms wall budget cuts a ~1.7 s mock stream. Discrimination: budget gate off → t14 red; rounds +96 → t13 red; deadline/signal pass-through removed → t15 red (bench proof the caps are free when idle: identical 24399 tokens / 22 calls 7/7). Side-effect approvals remain governed by guard/exec policy (tests in test/guard*). | mock | PR #41 | PASS | 2026-10-19 |
| 4D | 4 | Real cross-domain tasks with independently checked results | `test/domains.test.js` 5/5 (command/json_topkeys/url_contains + E2E repair-on-lies); `test/domains-live.test.js` 2/2 with MAJIN_LIVE=1 (real https google fetch + real `node --version` exit + LIVE longcat session wrote mission-live.json {answer:42, task:…}, VERIFIED sha, tokens measured live) | bench + opencode live | main `497cde3` | PASS | 2026-10-19 |

## DEL 5 — Browser & Computer Use (8/10)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 5A | 2 | Forms and interactive controls | `test/browser-domains.live.test.js` 5A green in exe-CI (Windows Edge): text/select/radio/consent posted + observed AT THE SERVER: {"name":"Siri Testsson","mail":"siri@test.dev","stack":"node","level":"senior","consent":"on"}; thanks-words proven | live browser (CI) | main `c6b4ce3` | PASS | 2026-10-19 |
| 5B | 2 | Dynamic navigation, tabs, iframes | `test/browser-domains.live.test.js` 5B green in exe-CI (Windows Edge): hash-rendered content proven, target=_blank followed via engine meta openedNewTab:true, iframe host + straight-path verification | live browser (CI) | main `c6b4ce3` | PASS | 2026-10-19 |
| 5C | 2 | Observation and bounded recovery (no blind click loops) | `node --test test/browser.test.js` — LoopJournal stops 3 identical actions cold; slot pool queues; session isolation | node, no browser | main line | PASS | 2026-10-18 |
| 5D | 2 | Real Windows computer-use scenarios | — | needs Windows runner | — | UNVERIFIED | 2026-10-18 |
| 5E | 2 | Multi-step real website workflow without unverified completion claims | same suite 5E green: search→product→cart→checkout→confirm, every step cross-checked against SERVER state (cart=[{sku:X900,qty:1}], /order POST recorded) — never page-text-only | live browser (CI) | main `c6b4ce3` | PASS | 2026-10-19 |

## DEL 6 — GENESIS ZERO & Cost (6/9)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 6A | 3 | Real per-task usage + strict budget enforcement | One guard `budgetGate` in `src/core/loop.js` at BOTH spots the loop can spend: monthly ledger pre-check (over-cap PAID dies before the call; free routes keep working; unknown price under cap → "unknown never spends") and per-task check AFTER each measured step (`budget.perTaskUsd`, default 0=off, fires only on REAL measured cost — 10M free tokens trip nothing). Turn usage carries `priceKnown` via `priceKnownForRoute` (priced/local/mock/0-priced = KNOWN; priceless cloud = UNKNOWN); ledger keeps `unpricedCount` so unknown never reads as known-$0. `test/budget.test.js` 5/5: gate-level synthetic routes; live loop with a deliberately expensive mock route ($1e9/Mtok) stopped after exactly 1 counted call with `stopReason: task-budget` and the measured $ number in the stop message; same workload without cap runs both steps (control). Discrimination: per-task gate off → t2+t3 red; monthly gate off → t1 red; price-always-known → t5 red; gate-on-tokens-not-cost → free-tally assertion red. | mock | PR #45 | PASS | 2026-10-19 |
| 6B | 3 | Model profiling, routing + single-model guarantee | `test/singlemodel.test.js` 3/3 (one chosen model covers all routes, MOA off); `test/subset.test.js` tool-subset selection | mock | main line | PASS | 2026-10-18 |
| 6C | 3 | Comparable verified quality at lower measured cost | Free opencode models verified tasks at $0, but no same-task matrix vs other models | opencode free | — | UNVERIFIED | 2026-10-18 |

## DEL 7 — Skill Compiler (8/8)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 7A | 2 | Capability discovery + missing-capability detection | `test/capability.test.js` 7/7; `test/github-research.test.js` 4/4 | mock/github API gated | main line | PASS | 2026-10-18 |
| 7B | 2 | Safe adapter creation + validation (schemas, permission classes) | Adapters are DECLARATIVE `http-json` descriptors (`src/core/adapters.js`): hard `validateAdapter()` BEFORE any write (https-only-or-localhost, no `javascript:`/`data:` schemes, no raw secrets in headers — `{env:NAME}` placeholders only, code-shaped mapping paths rejected, kind allowlist, permission ∈ `read | external-write | external-post`, sane timeout/rate clamps); invalid spec → REFUSED, nothing reaches disk; atomic tmp+rename write; surfaced via `majin.adapter` validate/create/list/remove | `node --test test/adapters.test.js` (4 tests: happy path; 8-way unsafe-spec rejection incl. disk-empty proof; permission-class contract; localhost-dev vs remote-non-TLS) | 5-way discrimination incl. S4 (create skips validation → 7B.2 red), S5 (remote http accepted → 7B.2+7B.4 red), both restored green | **PASS** | 2026-10-19 |
| 7C | 2 | Verified reusable skills w/ failure tracking and disable-on-repeat-fail | `Skills` (memory.js): `recordOutcome({ok,why})` counted on DISK state (multi-instance honesty — no in-memory streaks), frontmatter `fails/streak/disabled/lastFailWhy`, success resets streak, N=`skills.maxFails` (default 3) consecutive failures → DISABLED honestly (never deleted); disabled skills filtered from `match()` and `prompt()` (never reach the model); explicit `enable()` resurrects; atomic writes; surfaced via `majin.skill` report/enable | `node --test test/skills-failures.test.js` (5 tests: 3-fail disable + disk persistence; success reset; enable resurrection; prompt exclusion; two-instance shared truth) | 3-way discrimination: S1 (disabled still selectable → 7C.1+7C.3 red), S2 (never disable → 4 red), S3 (success keeps counter → 7C.2 red), all restored green | **PASS** | 2026-10-19 |
| 7D | 2 | End-to-end new capability through the existing engine | `Adapters.call()` (adapters.js): a validated descriptor (7B, re-read + re-validated per call — hand-edited hostile specs are refused at execution) runs end-to-end: permission class decides method (read→GET, external-write/post→POST), external classes require BOTH the `approved` tool-arg AND a live decision from the engine's `approvals.request` singleton (the same gate that guards jobs.send — denied decision never hits the wire), rolling-hour rate limit from a disk sidecar (`.state-{name}.json`), AbortController timeout counted as failure, 4MB cap, json-only, dotted-path mapping with array enumeration (`mapRows`), N=`adapters.maxFails` (3) consecutive failures self-disable the adapter (no more network attempts) until explicit `enable`. Tool: `majin.adapter` call | enable | `node --test test/adapters-exec.test.js` (5 tests: GET→rows end-to-end via local server; per-call re-validation vs hand-edited spec; approval gate both ways + body integrity + self-disable + enable; rate limit + timeout-as-failure; mapRows semantics) | 4-way discrimination D1 (approval skipped → 7D.3 red), D2 (rate off → 7D.4 red), D3 (never-disable → 7D.3 red), D4 (re-validation off → 7D.2 red), all restored green | **PASS** | 2026-10-19 |

## DEL 8 — One-Chat UI & Imagination (0/8)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 8A | 2 | Onboarding + model switching in the real interface | `test/onboarding.test.js` 7/7 prove endpoint-level onboarding; **no model switch action in the chat UI** (gap also required by Del 1) | — | — | UNVERIFIED | 2026-10-18 |
| 8B | 2 | Task cards reflect real backend state | `test/one-chat-ux.test.js` 3/3 exists; not mapped to live worker cards | — | — | UNVERIFIED | 2026-10-18 |
| 8C | 2 | Living Canvas + safe previews with real artifacts | `test/imagination.test.js` 4/4; `test/imagination-preview.test.js` — declarative rendering rules; living-canvas pass not formally run | — | — | UNVERIFIED | 2026-10-18 |
| 8D | 2 | Accessibility/performance/interaction tests | No a11y suite | — | — | UNVERIFIED | 2026-10-18 |

## DEL 9 — Real-World Workflows (5/5)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 9A | 1 | Job workflow real test evidence + explicit approval before submit | `test/jobs.test.js` 13/13 (state machine, dedupe, CV-match, Platsbanken parser, approval-boundary) + gated live probe | offline + gated live | main line | PASS | 2026-10-18 |
| 9B | 1 | Marketing workflow evidence + no publish without permission | `test/marketing.test.js` 10/10 (+ `marketing-plan.test.js`, `marketing-channels.test.js`) | mock | main line | PASS | 2026-10-18 |
| 9C | 1 | Coding/research workflow evidence | `test/re.test.js` 8/8 ("RE-spec between understanding and rebuild, with proof per claim"); github tools against real API gated | mock | main line | PASS | 2026-10-18 |
| 9D | 1 | Creative/productivity workflow evidence | Dedicated E2E acceptance: 3-chapter story composed step-by-step by the agent (4 scripted fs.write calls through the live registry) — every artifact byte-verified ON DISK (not from transcript), index.json cross-references all chapters, final answer names the work; second pipeline: notes.md → structured brief.json with decision extraction and untouched source | `node --test test/creative.test.js` (2 tests: 9D.1 creative story+index, 9D.2 productivity pipeline) | 2-way discrimination: C1 (fs.write no-op stores nothing → both red), C2 (registry wipes tool args → both red), both restored green | **PASS** | 2026-10-19 |
| 9E | 1 | Financial research / paper trading with costs + no profit promises | `test/trading.test.js` 7/7 | mock | main line | PASS | 2026-10-18 |

## DEL 10 — Security & Privacy (5/5) ✅ COMPLETE

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 10A | 1 | Permissions and approval enforcement | bench scenario `guard-approval` green; approvals gate in `src/core/guard.js` | bench (mock) | main line | PASS | 2026-10-18 |
| 10B | 1 | Secret protection and privacy | `test/provider-flow.test.js` — saved key never echoed; `cfg.redacted()` masks | — | `cc604d2` | PASS | 2026-10-18 |
| 10C | 1 | Prompt-injection resistance (web/repo/doc) | `src/core/injection.js`: 11-pattern override corpus; `scanInjection` catches every corpus line with zero false positives on clean text; `guardToolContent` wired into THE loop's tool-result message path — infected results are annotated in the very message the model reads (`INJECTION-PATTERN WARNING` + UNTRUSTED-DATA marker) and emitted as `injection_warning` events; clean results pass byte-identical (zero token tax). Live-loop proof: poisoned file from ws is annotated already in the next model call (mock lastCalls inspection), clean sibling passes untouched; final answer honestly reports the attempt | `node --test test/adversarial.test.js` (3: corpus breadth/false-positives; annotate-vs-clean; live loop E2E incl. event + message-level assertions) | 3-way discrimination: A1 (scan off → all red), A2 (corpus emptied → all red), A3 (detect-but-never-annotate → 10C.2/10C.3 red), restored green | **PASS** | 2026-10-19 |
| 10D | 1 | Process/file isolation + cancellations actually stop work | `test/readonly.test.js` 6/6 (read-only turns cannot touch); workspace escape refusal in `resolveIn` | mock | main line | PASS | 2026-10-18 |
| 10E | 1 | Real adversarial regression tests | `test/adversarial-regressions.test.js` 5/5 across 6 classes (docs/ADVERSARIAL.md); REAL bug found+fixed: config `__proto__` patch could reach guard.pwned — merge/getPath/setPath hardened; sabotage E1 (filter removed) → V2 red | bench (mock harness) | main `497cde3` | PASS | 2026-10-19 |

## DEL 11 — Windows Installer, Updates & Delivery (2/4)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 11A | 1 | Clean Windows install + first run | `test/installer.test.js` 12/12 (Inno/shortcut config); a real clean Windows box has not run the flow | needs Windows | — | UNVERIFIED | 2026-10-18 |
| 11B | 1 | Old-version→new-version update path | `node verify-update.mjs` → status `available`, notice + correct asset + sha256 asset against the live release v0.5.7/v0.5.8 | linux, live GitHub | v0.5.5-line | PASS | 2026-10-18 |
| 11C | 1 | Data preservation + failure recovery across updates | No test runs an old config/session set through an upgrade | — | — | UNVERIFIED | 2026-10-18 |
| 11D | 1 | Verified release artifacts (checksum + integrity) + no asset/tag overwrite | v0.5.6/0.5.7/0.5.8: 4 assets each (EXE + installer + 2×.sha256), HEAD-200 downloads, `release-safety.test.js` guards | GitHub API | `2c5f308` | PASS | 2026-10-18 |

## DEL 12 — Final Real-World Acceptance (1/3)

| ID | Pts | Required observable behavior | Evidence + reproduction | Env/model | Commit | Status | Verified |
|---|---:|---|---|---|---|---|---|
| 12A | 1 | Independent real-model end-to-end acceptance suite | `test/acceptance-live.test.js` 3/3 with MAJIN_LIVE=1: A1 live create json VERIFIED (43 379 tokens), A2 live append via fs.patch preserved-original (281 891 tokens), A3 engine-only lie-detector (missing-file + exit 7 named honestly) — verdicts by code, never by a model | opencode live | main `868085b` | PASS | 2026-10-19 |
| 12B | 1 | Real Windows user-journey + recovery suite | — | needs Windows | — | UNVERIFIED | 2026-10-18 |
| 12C | 1 | Release candidate passes all mandatory integration gates | — | — | — | UNVERIFIED | 2026-10-18 |

---

## Current frontier (remaining 19 unearned points, by row)

**Audit 2026-10-20 (external review + own row-level recount): exactly 19, not 20.**
Eleven UNVERIFIED assertion rows: 1E(2) 5D(2) 6C(3) 8A–8D(2+2+2+2=8) 11A(1) 11C(1) 12B(1) 12C(1)
= 19 = 100 − 81. This list is documentation, NOT assertion rows — plaintext on purpose so no
automated scan can double-count it.

- **1E (2)** — live two-provider handoff — needs a SECOND free provider (opencode exists; local Ollama or another free key candidate — investigation in flight 2026-10-20).
- **5D (2)** — real Windows computer-use scenarios (owner machine / suitable runner) — see v0.9.9 UIA evidence + raw-UIA decision; `win-control-poc` workflow re-dispatched 2026-10-20 for fresh CI evidence.
- **6C (3)** — comparable verified quality at lower measured cost — needs a priced/free comparison matrix (paired with the second-provider work).
- **8A–8D (8)** — UI & Imagination rows — UI owned by OTHER agent (do not touch); needs their branch merged. *2026-10-20 audit: claimed "PR #79" does not exist (GitHub 404); ui/* branches unpulled — nothing to recover in-repo.*
- **11A (1)** — clean Windows install + first run — now automated: `.github/workflows/win-acceptance-install.yml` (dispatch-gated).
- **11C (1)** — data preservation across a real install-over-install — same workflow (11A/11C/12B verdict JSON).
- **12B (1)** — real Windows user-journey + recovery — same workflow (`_serve` mid-task hard-kill + restart; deeper in-app journeys still need a fuller installation script — honest split).
- **12C (1)** — release candidate passes ALL mandatory integration gates — last, after the Windows rows.

Executive summary of who can earn what without new credentials: nothing — every open row needs
either the owner's Windows session (5D, 11A, 11C, 12B → 12C), the other agent's UI merge (8A–8D),
or additional free provider keys (1E, 6C). This is the honest 81/100 ceiling today.

Frontier (historical, completed items preserved for audit):
1. ~~Del 1D~~ ✅ PASS (PR #39).
2. ~~Del 4A+4C~~ ✅ PASS (PRs #40/#41).
3. ~~Del 3C/3D/3E~~ ✅ PASS (PR #43 + live bench).
4. ~~Del 2C~~ ✅ PASS (PR #44).
5. ~~Del 12A~~ ✅ PASS — re-verified LIVE on main `24fcd5d`, 2026-10-20 (3/3, opencode free tier);
   the point was earned 10-19 but never counted into the phase/TOTAL rows — summaries reconciled
   to the row-sum on 2026-10-20.

A regression in any PASS row revokes the points until re-proven on `main`.
