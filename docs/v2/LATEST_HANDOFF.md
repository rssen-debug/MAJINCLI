# MAJIN V2 — LATEST HANDOFF (owner-facing, 2026-10-21)

V2 HEAD (v2/main): 003f07a + in-flight PR (this turn: scheduler work, merges at end of turn)

COMPLETED (this working day, verified):
- v2/main created from V1 tip 282a8ff; V1 untouched (policy: only v2/* branches carry V2 code)
- V2 identity 2.0.0-alpha sealed in 5 places; production publisher scoped to v1.* tags
- v2-fast-ci.yml: green on v2/main pushes (runs 39674378385, 39677942161)
- Goal kernel: 12-state machine, tamper-evident receipts, COMPLETE-gate on verified acceptance, crash-resume (8/8 tests)
- DAG + scheduler: dependency graph, p-queue bounded concurrency, transient-retry per normalized failure class, failure propagation, JSON resume (8/8 tests)
- Failure class table: 19 classes (prompt §23 list) + retry policy + error shape → class mapping
- Dependency audit with evidence: p-queue adopted (MIT), node:sqlite deferred (needs Node>=22.13 floor at packaging), better-sqlite3/xstate/toposort rejected with reasons — docs/v2/DEPENDENCIES_AND_LICENSES.md

VERIFIED:
- Full suite local: 963 tests / 946 pass / 0 fail / 17 skip (npm test, twice)
- CI: v2-fast-ci green on v2/main, v2/agent-runtime x2, and this PR pre-merge

CI (state at handoff): v2-fast-ci GREEN on v2/main tip

WINDOWS (owner PC): not re-run against 2.0.0-alpha yet (phase 4 activity; channel majin-remote-command ready)

BENCHMARK: baseline 930-pass pattern recorded in BASELINE_AUDIT; no changes to perf budgets yet

FAILED: none open on v2/main

BLOCKED: none

OPEN PRS: scheduler PR (merge tracks end of this turn)

NEXT (roadmap order):
1. Verifier registry (file/http/dom/pixel checks) reusing src/core/goal-artifact.js
2. Event bus typed events into Studio timeline
3. GAUNTLET harness skeleton (PHASE 10), then hardware lane vs 2.0.0-alpha via majin-remote-command
