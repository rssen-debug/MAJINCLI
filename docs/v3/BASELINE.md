# MAJIN V3 baseline

**Measured:** 2026-10-22, Europe/Stockholm.
**Repository:** `https://github.com/rssen-debug/MAJINCLI` (public read-only clone; no GitHub connector available).

## Protected refs at start of round

| Line | Ref | SHA | Protection result |
|---|---|---|---|
| V1 | `origin/main` | `814459ea50fc86c5ac1aeed939ec9d2344dc5bfb` | Read-only; no V3 edits on this ref |
| V2 | `origin/v2/main` | `b2533097ca3c744fa7e9b152b221a97186507835` | Read-only; used only as the source/base for separate V3 branch |
| V3 | local `v3/main` | initially `b2533097ca3c744fa7e9b152b221a97186507835` | Created from `origin/v2/main`; no remote `v3/main` existed at first inspection |

The initial `git ls-remote` found only `main` and `v2/main` among the requested refs. V3 commit/push status is reported separately; a local branch is not a remote branch.

## Repository and runtime baseline

- V1 has the mature Node desktop/browser/tool/provider code under `src/core/` plus Windows install and release infrastructure.
- V2 adds `src/v2/` goal, DAG, scheduler, receipts, verifiers, context/memory, provider profiles, voice adapters, safe execution, approvals, telemetry, audit and Studio surfaces.
- `package.json` is MAJIN `2.0.0-alpha`; its `engines.node` says `>=20.11.0`. During `npm ci` on Node `v20.20.2`, installed packages emitted `EBADENGINE` warnings requiring Node `>=22` for `canonicalize`, `p-queue` and other transitive packages. The suite passed here, but the supported engine floor needs reconciliation.
- No additional V3 dependency is introduced.

## Baseline test run (before V3 implementation)

Command: `npm ci --ignore-scripts --no-audit --no-fund && npm test`
Environment: sandbox Linux, Node `v20.20.2`, npm `10.8.2`.

| Outcome | Count |
|---|---:|
| Passed | 1,176 |
| Failed | 0 |
| Skipped | 19 |
| Total | 1,195 |
| Duration | 218,475 ms |

Skipped tests include environment-gated/live lanes and do not prove provider-key, microphone, Windows desktop, browser GUI or release behavior.

## V3 starting state

- No V3-specific docs or remote V3 branch were present at inspection.
- V3 files are being added on `v3/main` only.
- The first implementation is a deterministic single-file goal flow. It does not use an LLM, voice, browser, desktop or external network integration.
- Initial V3 score is calculated only from the new evidence matrix, not from inherited V1/V2 code counts.
