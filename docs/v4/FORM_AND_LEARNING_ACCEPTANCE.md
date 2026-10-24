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

**Status 2026-10-24:** the engine is built, integrated and proven end to end in
this repository. The mandatory real-Go acceptance is the one step that cannot run
here (no provider key), so it stays unverified until `npm run v4:learn-accept`
is run on the host. That is the only open item in this section.

Implemented in `src/v4/learning.js`, integrated into the existing agent, skill
loader, memory and API — no second engine, no second store:

- extraction only from a goal that reached `COMPLETED` **and** carries an
  independently verified receipt; a model's own claim is never evidence;
- the stored procedure records tool names and **argument names only**, never
  values; secrets, personal paths, e-mail addresses and CSS selectors are
  stripped before anything is written;
- `requires` is the intersection of the lanes that were granted and the lanes
  the successful path used, so learning can never widen permission;
- states EXPERIMENTAL → VERIFIED → REUSABLE, with STALE when the environment
  fingerprint changes and FAILED when failures lead; never silently promoted;
- retrieval is relevance-ranked, so a *related but changed* task finds the
  procedure; the prompt states the trust level and the "do not repeat" list;
- a recorded failed strategy is refused with an explanation instead of being
  executed again (`LEARNED_AVOID`);
- `GET /api/learning` exposes state, confidence, evidence and the avoid list.

Proven here (`test/v4/learning.test.js`, 15 tests): sanitising, extraction
refusal, argument-name-only storage, promotion, diagnosis, retrieval, the full
A–H flow with a real restart, the avoid guard, STALE on environment change, and
that a learned skill cannot claim an ungranted lane.

### The original text of this gate (unchanged)

Workflow: goal → execute → observe → diagnose → adapt → independently verify →
extract → store → retrieve/adapt → revalidate. Goals teach MAJIN; no new owner
master prompts should be necessary. Reuse the existing skills, execution journal
and canonical memory; persistence must survive a host restart and client sessions.

Each learned skill must retain: name/purpose/categories; tools and permissions;
preconditions; generalized procedure and successful example; failure/recovery
patterns; independent outcome-verification method; version/environment; evidence;
confidence/last successful validation; bounded retry/cost limits. No credentials,
personal data or brittle selectors may become universal instructions.

Statuses are distinct: EXPERIMENTAL, VERIFIED FOR THIS ENVIRONMENT, REUSABLE /
MULTI-SCENARIO VERIFIED, STALE, FAILED. ACHIEVED requires actual execution and
independent verification; a model-authored plan or assertion cannot promote it.
One narrow success cannot prove broad reliability. Changed environments require
revalidation. Failed/stale strategies must not be silently trusted or repeated.

Mandatory real Go acceptance: unfamiliar safe task fails; model diagnoses and
changes strategy; later outcome independently passes; model stores the resulting
skill; test host actually restarts; changed related task retrieves/adapts it;
independent verification passes and old failed strategy is not blindly replayed.
Preserve calls, attempts, costs/unknowns, artifacts, evidence and retrieval proof.
No autonomous production-code/security-rule changes outside a separately tested
and authorized deployment workflow.

## Other mandatory gates remain

Universal execution, voice/mobile, schedules/locked-phone push, canonical model
selection/billing, original parity, safe memory backup/reset, graph/team budgets,
trusted signing, actual Ghost installation/activation/autostart and host/app update
rollback remain in FINAL_FEATURE_PARITY.md and FINAL_EXECUTION_20261024.md.
An unsigned candidate, a merge, a green CI or a shared web view is not release READY.

At most eight engineering rounds in the referenced final-launch mission; round 8
is final verification, not feature expansion. Preserve a reproducible handover
with exact unresolved gates if any remain.
