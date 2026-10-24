# Mandatory V4 form and learned-skill gates

These requirements remain release gates. They extend the existing V1–V4 agent,
registry, journal, memory and skills. They do not authorize a new engine or a V5.
PR401 is merged at 704de63; older statements that it remains draft are historical.
Follow-up work starts from that actual v4/main baseline on
codex/v4-form-autonomy-20261024. No source-host activation is implied.

## Round 2: form autonomy — NOT READY until independently proved

Retain original failed Go receipts 1–8 and every later failed receipt. Tool tests
alone do not pass this gate. Real Go must complete all three different safe new
sites and the original failure fixture, through actual browser operations.

- A: dynamic conditional JavaScript controls and dropdowns.
- B: multi-step navigation, checkbox validation and file upload.
- C: server-side validation, correction and resubmission.
- Original regression: dynamic team signup, validation, replacement controls and
  cleared file selection after server validation.

For each, independently require one accepted server submission, every requested
value, exact received file hash and a saved/read-back actual unpredictable receipt.
No unauthorized external submissions, canned inference or synthetic success.
Record source hashes, real model rounds, tool calls, failures/recovery, limits,
provider token telemetry and honestly unavailable currency billing information.
Bound retries adaptively; do not just raise round limits or replay failed calls.

General product behavior includes live semantic labels/roles/DOM, control-type
operations, framework rerenders/stale refs, retained value verification and a
bounded alternative strategy; native/server errors, grounded submit buttons,
multi-step navigation, exact file bytes, auth/CAPTCHA/approval handoff and compact
observations. Product code may not contain fixture-specific selectors or recipes.

## Learned operational skills — IMPLEMENTED, awaiting the real-provider run

**Status 2026-10-24: PASSED — 14/14 against the real OpenCode Go provider.**

The mandatory A–H gate ran on GitHub Actions against the real provider (model
`glm-5.3-flash`, OpenCode Go), using the repository's existing `OPENCODE_API_KEY`
secret. No key was pasted, printed or stored anywhere.

```
  provider: env · glm-5.3-flash
  PASS  auth.paired                    pair -> 200
  PASS  turn.A.completed               completed
  PASS  turn.A.tool_calls              3 call(s): fs_read:not found: <dir>/CV Anders 2026.txt | fs_find:ok | fs_read:ok
  PASS  turn.A.failed_first_attempt    a real failure was observed
  PASS  turn.A.independent_verification at least one receipt was verified
  PASS  D.skill_stored                 learn-files-955cc0
  PASS  D.skill_manifest               state EXPERIMENTAL, 2 step(s)
  PASS  D.avoid_correct                none abandoned — the model corrected itself inside the run
  PASS  turn.A.cost                    4 model call(s), 16796 in / 309 out, $0.002674
  PASS  E.skill_survives_restart       1 learned skill(s) after restart
  PASS  F.turn.completed               completed
  PASS  G.skill_retrieved              the learned section and the skill name reached the prompt
  PASS  G.skill_used_or_adapted        memory_search:true, fs_list:true, fs_read:true · learned tools: fs_find,fs_read
  PASS  H.failed_strategy_not_repeated the failed action was not executed again
  14/14 checks passed
```

Copied verbatim to `docs/v4/evidence/learned-skills-real-go.txt`.

### What the real run demonstrated, step by step

| Step | What actually happened |
|---|---|
| A | The request named `CV Anders 2026.txt`; disk held `CV_Anders_2026.txt`. The model tried the given path and got a genuine `not found`. |
| B | It changed strategy to `fs_find`, which located the file. |
| C | `fs_read` succeeded and the receipt was independently verified (a read is verified by re-statting the file). |
| D | A skill was extracted and stored: `learn-files-955cc0`, EXPERIMENTAL, 2 steps, with an avoid list that is correct in both directions. |
| E | The host was stopped and started again on the same data dir; the skill was still there. |
| F | A related but different task was given. |
| G | The system prompt the host actually sent contained the learned section and the skill's name — direct evidence, not a proxy — and the model used a learned tool to complete the task. |
| H | The action that had failed was not executed again. |

Cost of the whole gate: **$0.002674** (4 model calls). Bounded by design; no external
service was retried without limit.

### A defect the real model exposed

`extractCandidate` marked an action as "abandoned" whenever more than one tool had
succeeded, even if the same tool had later succeeded in the same run. With the real
model that meant `fs_read` was listed as "do not repeat" after it failed once on a
wrong path and then worked on the right one — the skill was actively discouraging the
correct step. Fixed: an action is abandoned only when it never worked later in the
run and the work moved to a different tool (`test/v4/learning.test.js`).

### How it is run

```
# on demand, with the existing repository secret (no key handling)
gh workflow run v4-learn-accept.yml --ref v4/main

# or on the host, with a provider configured
npm run v4:learn-accept
```

The workflow also runs on a deliberate edit of `.github/learn-accept-trigger`, which
is how it was dispatched while `workflow_dispatch` was not yet available on this
branch. It fails hard if no key is configured instead of passing silently.

### What this does NOT prove

One narrow task, one model, one environment. Per the brief, a single success is
EXPERIMENTAL; broader reliability requires repeated verified runs across varied
tasks, and that is exactly what the promotion rules enforce. It says nothing about
the Windows host, the phone, or a browser lane.

## Other mandatory gates remain

Universal execution, voice/mobile, schedules/locked-phone push, canonical model
selection/billing, original parity, safe memory backup/reset, graph/team budgets,
trusted signing, actual Ghost installation/activation/autostart and host/app update
rollback remain in FINAL_FEATURE_PARITY.md and FINAL_EXECUTION_20261024.md.
An unsigned candidate, a merge, a green CI or a shared web view is not release READY.

At most eight engineering rounds in the referenced final-launch mission; round 8
is final verification, not feature expansion. Preserve a reproducible handover
with exact unresolved gates if any remain.
