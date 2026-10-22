# MAJIN V3 test evidence

**Validation environment:** Linux sandbox, Node `v20.20.2`, npm `10.8.2`.
**Verified V3 implementation commit:** `6b27fa6d93ce95d113569a408174ea4bfcbaaa05`.
**Scope caveat:** No Windows desktop, microphone, headed browser or operator credentials were used. The pasted credentials were not used; rotate/revoke them.

## V2 source baseline before V3 code

| Command | Result |
|---|---|
| `npm ci --ignore-scripts --no-audit --no-fund` | Completed; emitted `EBADENGINE` warnings for dependencies requiring Node >=22 although package manifest declares >=20.11. |
| `npm test` | 1,176 passed, 0 failed, 19 skipped; 1,195 total; 218,475 ms. |

## V3 targeted tests

Command: `node --test test/v3-vertical-slice.test.js`

- 7 passed, 0 failed, 0 skipped (including request-size rejection and server-recovery behavior).
- Covers V2 Goal reuse and state persistence, verified receipt and SHA-256, traversal/reserved filename rejection, create-only/no-overwrite behavior, minimal UI semantics and reduced-motion/no-external-assets assertions, real loopback HTTP request-to-goal-to-file-to-verification flow, cross-origin refusal, non-JSON refusal and loopback-only binding.
- Environment: Node `v20.20.2`, temporary workspaces on Linux.

## Full post-change suite

Command: `npm test`

| Outcome | Count |
|---|---:|
| Passed | 1,183 |
| Failed | 0 |
| Skipped | 19 |
| Total | 1,202 |
| Duration | 218,819 ms |

The 19 skipped tests are environment-gated. Their skipped status is not evidence of working live providers, Windows desktop control, real voice interruption, or V3 browser automation.

## Static and consistency checks

| Command | Result |
|---|---|
| `npm run check` | PASS — 450/450 JavaScript/module files parse cleanly. |
| `npm run i18n` | PASS — 0 Swedish string literals in 235 scanned files. |
| `git diff --check` | PASS — no whitespace errors. |

The broad existing benchmark suite rewrites timing snapshots when run. Those incidental generated benchmark changes were restored from the clean cloned baseline and are not part of the V3 change.

## Not run / not verified

- Playwright-rendered V3 browser UI, keyboard navigation, visual regression or screen reader test.
- V3 browser automation against public or authenticated sites.
- Real Windows desktop, UI Automation, installer, packaged executable or update workflow.
- Real microphone, barge-in latency, Swedish/English speech recognition, echo suppression or reconnect behavior.
- V3 model-provider live calls, API-key persistence, failure fallback or cost reporting.
- Crash/power-loss fault injection, Windows filesystem edge cases, concurrent goal checkpoints, objective benchmark, security penetration review or SBOM generation.

No performance or real-world task-success claim is made from mock/unit/integration results.
