# MAJIN V4 — continuation handover

Status: **NOT READY**. Latest pushed/deployed product before the approval-continuation milestone: `909d758e5c10ce8d58d62cca67cd78a5a8da4bdd`. Initial handover: `f62e6f6f9d27d16e63228125cb041e129324d437`. Use `git rev-parse HEAD` for this updated milestone identity.
Branch `codex/v4-final-integration-20261023`, draft [PR 401](https://github.com/rssen-debug/MAJINCLI/pull/401), target `v4/main`; no merge or production publication.

## Mission and scope

Complete a general-purpose intent -> plan -> real tools -> verification -> artifact
agent, without promising success on every external task. Preserve all original
parity requirements. The owner's Project Genesis objective additionally requires
explicit OpenCode Go billing/catalogue protections, canonical cross-device model
selection, real-model scenarios A–G, durable background monitoring and actual Web
Push received on a locked iPhone 13. None of these is waived by unit-test counts.

## Architecture and existing functionality

V4 uses V1 provider/browser/Windows adapters and V2 kernel, goals, tools, receipts,
teams and graph orchestration. No second agent engine or history store should be
created. `src/v4/server.js` serves authenticated HTTP/SSE and the shared minimal
client. `src/v4/agent.js` executes real-model turns; `models.js` wraps V1 catalogue
discovery. V1 scheduler/heartbeat/channels remain in `src/core` and should be reused.

Verified: real OpenCode Go `opencode-go / glm-5.3-flash`, streaming, actual verified
write/read; dependent graph 8 calls/peak 2; forced child-crash recovery; shared
canonical history across two existing sessions and host restart. CLI/version
migration, durable inline receipts and mobile hidden-overlay repair are saved.
Owner approved chat, restored Kokoro/am_adam and English audio on iPhone 13, while
still reporting latency. Hero is “Majin lets run it.” without suggestion chips.

## Ghost installation, data and provider

Machine DESKTOP-C1RSBUA. Actual source host `%LOCALAPPDATA%/MAJIN-V4-Host`.
Original source `%LOCALAPPDATA%/MAJIN-Ultimate-V4` remains preserved. Data:
`%LOCALAPPDATA%/MAJIN`; never reset it. Private backup outside Git under this
task's `work/private/ghost-backup`: 39 files restored byte-identically, 839 original
installation files checked, Git bundle includes the prior stash. Latest check:
23 original data/config/key/pairing files unchanged, six existing sessions.

Keep the working Go provider, keys and subscription unchanged. Never print or
commit config/auth values. Go is NOT Zen: current official documentation at https://opencode.ai/v2/docs/console/go/
now uses protocol-specific `/inference/go/openai/v1`, `/anthropic/v1` and
`/google/v1beta` bases beneath `/inference/go`. Ghost's preserved working route
is `https://opencode.ai/inference/go/v1`, with live catalogue and read-only usage
on `/models` and `/usage`. Older `/zen/go/v1` is also recognized. `/zen/v1` is
separate Zen. The first identity implementation missed Ghost's compatibility
path; production verification caught it before claiming PASS, and the follow-up
adds all documented exact Go paths without changing the working configuration. Shared hostname/model names do
not establish an entitlement. Verify current official documentation and actual
metadata; unknown billing must say “Cost unknown — verify with provider”. No
automatic paid fallback. The selector now uses one V4-owned durable `v4/model-selection.json` (no V1
credential/config rewrite), version conflicts, endpoint-bound cost authorization,
search, an included-only filter and six-second visible-tab synchronization.
All unverified account entitlements remain UNKNOWN. Zero token prices or a Go
endpoint do not prove subscription inclusion. The previously owner-configured
route is preserved; switching to another unknown-cost route requires explicit UI
confirmation. No alternate-model fallback is attempted on inference failure.
Model listing metadata retains the last verified catalogue after failed refresh,
marks it stale, and keeps known context/tools/price source/time when provided.
Exact HTTPS endpoint distinguishes Go from Zen. The included filter can honestly
be empty until account entitlement is established. This is PARTIAL, not full Go
acceptance: actual entitlement and switching two eligible live models remain open.

Loopback host port 7373; Tailscale HTTPS origin is
`https://desktop-c1rsbua.tailaf5875.ts.net`. Source Node supervisor and local Python
voice worker are running. User-level environment config points at the existing
worker/client and local model caches; no keys belong in this document.

## Voice and in-progress edits

Existing `scripts/majin-kokoro-voice.py` runs Kokoro/am_adam and warm multilingual
Whisper tiny locally. CPU bounded to two threads per engine, ONNX idle spinning
disabled. V4 uses existing V2 command STT/TTS via `local-voice-client.mjs`.
Initial successful synthetic HTTPS STT -> actual model -> WAV: 11.266 s. This is
not a physical latency measurement. Real iPhone natural interruption, explicit
5G reconnect and full Ghost audio acceptance remain unconfirmed.

Segmented WAV streaming now reuses the SAME Kokoro service and authenticated
voice endpoint, with bounded text, abortable playback, sequential segment
validation and URL/listener cleanup. Explicit activation: `MAJIN_V4_STREAM_TTS=1`
and an existing local TTS command. Hosts without it keep the full-WAV route.
PWA shell 11 also carries the canonical selector and prevents old client code remaining cached.

Focused voice tests: 25 passed, 0 failed, 0 skipped. Synthetic loopback benchmark
in `evidence/ghost-voice/stream-latency.json`: first audio 4270 ms, stream completion
13503 ms (three segments), whole-WAV comparison 11563 ms, identical text/model.
Kokoro create_stream alone gave one batch for a normal reply; sentence-sized
inference units fix that first-audio bottleneck. This does NOT measure iPhone
end-to-end latency or prove physical interruption. Streaming code is deployed and enabled on Ghost at `fffa918`.
Authenticated Tailscale HTTPS: first WAV segment 4301 ms, complete 7758 ms,
two valid segments, shell 9 served, existing sessions preserved. Evidence:
`evidence/ghost-voice/stream-https.json`. This is synthetic text, not phone timing.
The temporary 18766 worker has been stopped by verified PID/command. Supervisor
session 55449 keeps production running; host PID was 8784. Recheck current PIDs.
Canonical selector `8ab8434` was fast-forwarded and only the source host child
was restarted by the existing supervisor. Live verification found the Go identity
path omission; the follow-up identity fix and usage display still need deployment
before rerunning `../ghost-model-selection-live.mjs`. No new model or cost was
authorized by the failed check. Actual Go catalogue returns 37 models; usage
endpoint HTTP 200 has rolling/weekly/monthly windows only, no entitlement or Extra
Usage flag. New adapter exposes only validated window status/percent/reset time,
source and timestamp, retaining stale data honestly. It never labels these as
proof of subscription inclusion or disabled overage. Keep full P1 PARTIAL.

Files: `scripts/majin-kokoro-voice.py`, `scripts/v4/benchmark-narrator.mjs`,
`src/v4/voice.js`, `src/v4/server.js`, `src/v4/ui/voice.js`, `src/v4/ui/app.js`,
PWA shell references, and `test/v4/voice-stream.test.js`.

## Latest evidence and failures

See `FINAL_RELEASE_REPORT.md`, `FINAL_FEATURE_PARITY.md`, `GHOST_ACCEPTANCE_20261023.md`
and `evidence/ghost-final-status.json`. Legacy: 1284 passed/0 failed/23 skipped
after resolving 43 reproduced failures. Completed local V4: 505/0/0, but checkout
changed during that run; do not assign it to an immutable latest head. Exact
`0dad743` V4 CI: 501/0/5, 617 sources parsed, i18n passed. At the last observation
for `930e2fb`, runner passed and V4/Windows desktop CI were running; recheck now.
The 18 omitted-module DOM harness regressions were corrected and 18/18 retested.
New combined model/selection/real-client DOM regression: 40 passed/0 failed/0 skipped.
New selector browser regression: 2 passed/0 failed/0 skipped (isolated Edge Chromium
and Windows WebKit, mobile touch + desktop, search/filter, rejected/accepted cost
consent and cross-client propagation). Initial Chromium discovery skipped because
the default revision was absent; explicit existing Edge was then tested successfully.
No physical iPhone or live Go acceptance is inferred from those fixtures.
At `930e2fb`: V4 CI and Windows runner passed; Windows desktop CI was CANCELLED.
Recheck CI against the actual newest SHA before any release decision.

Untracked screenshots, generated benchmark JSON and Python caches in the working
checkout are test outputs, not unrelated owner edits. Do not blindly add them.
The original `browser-run.json` was restored; fresh browser evidence is saved as
`ghost-browser-run.json` to preserve historic reports.

## Remaining requirements and decisions

P0: live-model unfamiliar dynamic form/upload, software build/test/repair,
research, reversible Windows control, durable orchestration/cancellation/resume,
mobile execution and two-model Go acceptance. Existing injected-planner tests
do not prove real-model desktop/browser control. External submissions need the
owner's scoped authorization; no CAPTCHA/access-control bypass.

P1: Implemented canonical selection/version conflicts, search/included filter,
unknown-cost confirmation and inference-side route authorization; exact endpoint
identity and stale catalogue preservation. Remaining: account entitlement proof,
verified included default and meaningful included filter contents, two real eligible
Go models switching through both physical clients, verified price/limit metadata.
Do not label the complete P1 requirement PASS from the local fixtures.

P2: reduce first-audio latency; preserve the approved narrator; test interruption,
background release/reconnection on physical iPhone. Do not re-request already
granted ordinary development authorization. Batch necessary physical tests.

P3: actual login autostart, native installation, production signing, host/native
update activation/restart/rollback, every parity gap: channels/proactive heartbeat,
separate-store memory sync, typed self-config/safe reset, V4 audit/anchors/export,
durable graph resume/replan, team checkpoint coordination and token/currency
budgets, documents/previews/OCR/large files, DPI/multimonitor and background delivery.

Mandatory always-on extension: reuse scheduler/heartbeat; durable natural-language
monitor tasks, deterministic conditions/dedup/budgets, edit/pause/resume/cancel,
restart recovery, real external-source check and controlled threshold test; secure
Web Push subscriptions and notification history/deep links. PASS requires actual
notification on the owner's locked iPhone, not reopened chat or a mocked push.

External dependencies: approved production signer/channel absent. Unsigned native
installer was blocked by Windows application control; never bypass. Scheduled
task failed and is disabled; a user Startup shortcut is registered but its test
launch was blocked by automatic review. Actual logon remains unverified. Browser
opening was denied by saved origin permission even after renewed owner consent;
do not try alternate surfaces/CDP/shell as a workaround. The owner opened the site
manually. Respect that boundary while continuing independent coding/testing.

## Safe next commands and delivery

From the working repository:

```powershell
git status --short
git rev-parse HEAD
node --check src/v4/ui/voice.js
node --test test/v4/voice-server.test.js test/v4/voice-capture.test.js
npm run i18n
```

Streaming is measured/deployed; isolated worker stopped. Complete push/deployment
of the canonical selector, recheck authenticated production catalogue and real
inference using the existing Go route. Never authorize unknown additional costs
on the owner's behalf for switching tests. Then prioritize real-model scenarios
A–G and durable scheduler/heartbeat/push integration, retaining every original
parity requirement and reusable verified-error memory without automatic production
code mutation. Do not spend the budget repeating unchanged full suites.

Git CLI account lacks push rights. Use the authorized GitHub connector's
create_tree/create_commit/update_ref with expected parent; helper
`../index-tree.mjs` exports canonical staged text and Git tree SHA. Verify remote
tree equals `git write-tree`, fetch, verify `git diff FETCH_HEAD --quiet`, and
only then update local HEAD. Pull installed source with `--ff-only`; restart only
the affected supervised process after verifying its exact PID/command. Do not
change global credentials or overwrite someone else's edits.

READY requires all original and Genesis gates, actual model-selection billing
proof, real-model scenarios A–G, installed Windows/mobile acceptance, physical
voice and locked-iPhone push, login/restart/update/rollback/data preservation and
approved production trust. Until then keep PR draft/open and report NOT READY.


### Follow-up focused verification

Go compatibility/canonical endpoint identity and strict usage parser: focused
model/selection/voice-stream set 29 passed, 0 failed, 0 skipped. Previous selector
browser tests 2/0/0 and combined model/client DOM tests 40/0/0 remain distinct
runs; do not add overlapping counts. The working Go config remains unchanged.
Do not infer Extra Usage disabled: official Go docs explain that enabled Console
Extra Usage can bill the existing Go route after allowance exhaustion. Account
verification remains required before claiming no extra charges.


## Live model/canonical selection and host activation — current checkpoint

`evidence/ghost-model-selection.json` records actual authenticated Tailscale
HTTPS: 37 live Go catalogue entries, validated usage windows, canonical
`opencode-go/glm-5.3-flash` version 1 in two existing sessions, stale update 409,
real model workspace_write + workspace_read, independently verified exact file
bytes and original V1 config unchanged. After another source child restart,
selection version 1 and both sessions still agreed. Account inclusion/Extra
Usage remain unknown; no other model was authorized or tested. Full physical
mobile/Windows selector acceptance remains open.

The owner then explicitly said in this chat: full computer access, continue.
Owner Mode was OFF. Using that authorization, activated 63 existing host tools
in files/shell/sys/web/research/net/desktop/screen/computer/audit/learn/flows.
Filesystem grant is ONLY the MAJIN workspace. Existing approval policy remains
unchanged; no system-drive/profile/credential-folder grant. Other lanes were
not needed. Recheck `/api/capabilities` rather than assuming registration means
actual execution. Existing supervisor session 55449 remains active; parent PID
was 15736 and source child was 14980 before the next restart; identify afresh.

Actual Go discovery probe selected sys_info, exec_backends and exec_start, then
correctly waited for process consent. It did NOT finish or create the requested
artifact (`evidence/ghost-tool-discovery.json` records failure/incomplete, not
PASS). That exposed a P0 bug: resolving approval executed only the held action
and prematurely completed the task, abandoning the remaining model plan.

The current verified code fix extracts the EXISTING model loop for fresh and
continued turns (no duplicate agent engine), persists pending batch/model context,
prior tool results, budget counters, request ID and tool exposure, then resumes
at the exact held call after one-use consent. Earlier actions are not repeated.
Valid pending checkpoints survive host boot, including conversations older than
the drawer's 100-row limit. Malformed or legacy checkpoints fail closed. Approval
continuations remain cancellable and session-owned, and model-round exhaustion
now reports incomplete failure instead of success. One-shot approval is retained.

Focused results before the full run: agent/turn/context/client-DOM 52/0/0;
agent/crash/conversation after drawer-limit change 34/0/0. New regressions cover
multiple held actions in one batch, real disk reload/reconciliation, no duplicate
side effects/approval, unreset budgets, invalid checkpoints and cancellation.
A justified full V4 run with concurrency 2 was started after the final shared-loop
code edits, log `../genesis-full-v4.log`, exec session 79719. Do not claim it passed
until completion or change tested source during that run. Source tests can spend
up to their 120-second child timeouts in acceptance/CLI fixtures. Preserve failed
results. Do not kill unrelated Codex/MCP/browser processes by executable name.

Next: finish full run, repair actual failures, commit/push/deploy this milestone,
then repeat the REAL Go host-inspection probe and explicitly inspect any held
process command before approving under the owner's authorized controlled test.
The old pre-fix pending probe has no continuation and must not be claimed resumed;
boot reconciliation will block it honestly. The previous generated read-only
command was a Node OS/platform/CPU query, not an arbitrary shell operation.
Then prioritize previously unseen browser form/upload and software build/repair
with real Go, followed by persistent scheduler/heartbeat/Web Push. Keep the
complete original acceptance matrix and every external release blocker.

Potential budget issue: production defaults are four model rounds/six tool calls
per turn. Do not hardcode a special case or reset counters to make acceptance
pass; longer tasks need an explicitly bounded general budget policy. Persistent
monitoring is still FAIL and locked physical iPhone push is still FAIL.


### Full regression result and integration repair

The full V4 run finished: **524 passed, 1 failed, 0 skipped / 525 tests**,
472.162 seconds. Only failure: the OLD per-conversation model-selection
integration test sent no expectedVersion/cost authorization and expected 200;
the new protective API correctly returned 409. The same sole failure occurred
in exact `909d758` CI: Linux 513/1/7; Windows 519/1/1. Windows runner passed;
packaging was skipped after the failed test gate. Do not call those CI runs green.
The integration test is updated to the requested canonical setting, explicit
cost authorization and actual host restart. Separate repaired integration suite:
5 passed/0 failed/0 skipped. No authorization gate was relaxed.

Review also found that the UI did not show Stop during approval continuation.
Fresh turns and continuations now share startStream/finishStream; Stop includes
both current turn and conversation handles so an old finished journal ID cannot
hide the resumed task. Real-client DOM tests prove continued work remains busy,
completes normally, and can be cancelled: 2/0/0. PWA shell 12 carries this change.
The final current-source focused suite (agent failures/cancel/client DOM/
integration) finished: **45 passed, 0 failed, 0 skipped**, log
`../genesis-final-focused.log`. i18n: 0 stray Swedish literals in 322 files. Full-run browser output was copied to
`evidence/genesis-browser-run.json`; original historical browser-run.json restored.

Do not begin an identical full suite again merely to obtain a green count:
product core was stable during the full run; later changes are the corrected
integration fixture and focused-tested UI busy/cancel handler. New exact-head CI
will provide the immutable complete gate; recheck it. A final release still
requires every whole-suite/release gate and real-world acceptance.

Next scheduler review findings (not yet changed): core Scheduler uses a module-
global file path, non-atomic save that swallows errors, and manual fire does not
exclude an already-running job. Reuse and repair this engine when binding V4,
rather than introducing another scheduler. Cron zero steps/ranges must be
validated BEFORE loops; `*/0` currently risks a synchronous infinite loop.
Read-only deterministic monitors need durable condition/dedup/outbox metadata,
bounded retries and restart recovery; actual Web Push still needs implementation
and owner-granted installed-PWA permission/locked-phone receipt. Preserve all
original requirements, including meaningful approval details after reload.


## Verified execution and browser-isolation follow-up

Latest pushed/deployed source before this follow-up: `01c97b46fa093b4faa368baef294cdcec064add3`.
All three exact-head CI workflows are GREEN: V4 CI 520 passed/0 failed/7 skipped;
Windows desktop 526/0/1 including packaging, native-window smoke and packaged
cold start; Windows runner passed. Generic builder 'signing' log messages do
not establish an approved production identity; signer/channel and Ghost native
acceptance remain BLOCKED. Do not mistake hosted CI smoke for Ghost installation.

Live Go host inspection now COMPLETED after two narrowly inspected one-use
approvals: Node OS/CPU query and its exact exec_wait job. `sys_info`, tools_search,
exec_backends, exec_start, exec_wait, workspace_write, workspace_read each have
exactly ONE successful action receipt. Independently verified JSON: win32 and
four logical CPUs. See `evidence/ghost-tool-discovery-resumed.json`; the original
incomplete attempt remains in `ghost-tool-discovery.json`. Attempt/start events
include waiting and resumed dispatches; do not count them as duplicate executions.

General production budget knobs were explicitly set in USER environment to
12 model rounds / 24 tool calls, rather than resetting budgets or hardcoding this
task. The durable live goal verifies those bounds. V1 config, keys, original
history/pairing files remain unchanged (23 hashes match; 39 restored hashes match).
Supervisor session is now 64738; source child was 17260. Recheck identities before
stopping anything. Startup and physical acceptance remain separate.

Browser review found V4 was passing static session 'v4' to every adapted V1 tool.
The follow-up uses the existing AsyncLocalStorage goal ID for stable, isolated
V1 sessions across consent pauses and delegates. The same original browser engine
is reused. On task completion/cancellation/denial the owned HEADLESS browser is
closed and its fleet slot returned; owner-visible windows are preserved. Waiting
for consent keeps the task page. Two actual local browser processes passed this
isolation/lifecycle test with an INJECTED planner, not Go. Initial Windows sync
cleanup had EPERM; asynchronous guarded test cleanup passed. Do not hide that the
first fixtures failed cleanup, or claim physical/device/model proof from them.

Also fixed the V2 runner's unused deadline timer: successful/throwing/schema-invalid
calls now release it. Three subprocess tests prove natural process exit before
an otherwise-unused 30-second timer, while timeout/consent tests still pass.
Focused browser/host/agent/cancel regression: 175 passed, 0 failed, 5 skips.
Installer/timer/real-browser-lifecycle follow-up: 17/0/0. Eval client/fixture: 6/0/0.
Full ROOT legacy after shared-runner change: 1286 passed, 1 failed, 23 skipped;
only failure was the preexisting ASCII assertion rejecting the PS5 UTF-8 BOM.
The test now checks ASCII BODY after an optional BOM (not a security bypass);
installer tests passed in the 17-test follow-up. This is NOT a final green whole
legacy run. Original benchmark documents were restored; new generated copies are
in work/genesis-BENCHMARKS.md and work/genesis-SWARM_PERFORMANCE.md.

Two owned failed-test Temp folders remain: majin-goal-browser-oy3bC9 and
majin-goal-browser-dcZARi beneath Ghost's Local/Temp. Automatic approval review
REJECTED native PowerShell cleanup as 'blocked by policy', without another reason.
No alternate delete was attempted after that denial. Do not retry around policy.

Reusable LIVE acceptance client and randomized local form fixture are now under
`scripts/v4/evals/`. Client uses the real authenticated MAJIN HTTP/SSE pipeline,
keeps planning in Go, bounds events/approvals, never approves unknown scopes and
refuses to substitute demo. Cookie is never an argument or evidence value.
Explicit `--local-owner-home` reads ONLY an existing paired session and host HMAC
key, creates/rotates nothing, and can target ONLY loopback. Otherwise use an
existing paired cookie in MAJIN_EVAL_COOKIE; never print it. Unit tests prove the
local-owner helper does not modify files or forward credentials to a remote host.

The controlled form has randomized field IDs, dynamic team controls, a genuine
422 server validation step with re-render and cleared upload, actual multipart
file bytes, one saved receipt and duplicate refusal. Backend fixtures passed;
LIVE GO FORM ACCEPTANCE HAS NOT RUN YET. No model actions/selectors are scripted.
Use the CLI only after committing/deploying this follow-up:

```powershell
node scripts/v4/evals/browser-form.mjs --host http://127.0.0.1:7373 --local-owner-home C:/Users/Ghost/AppData/Local/MAJIN --workspace C:/Users/Ghost/AppData/Local/MAJIN/workspace --source-dir C:/Users/Ghost/AppData/Local/MAJIN-V4-Host --out docs/v4/evidence/genesis-form-attempt-1.json --approve-controlled-actions
```

This grants one-use approvals ONLY to this isolated fixture's browser operations
and exact synthetic upload file. It rejects other actions. Keep every failure
artifact; a rerun requires a NEW evidence output path. A PASS here covers the
controlled unknown-form/upload/validation chain, not external auth handoff,
physical mobile execution, cancellation, all A–G or universal success.
Then continue software build/test/repair and persistent scheduler/heartbeat/push.

### Controlled Go form failures and select repair, 2026-10-23

Actual installed source 43003d350704abff768bf381c6e36a0c59b2465e ran two
real Go/glm-5.3-flash form attempts. BOTH FAIL, preserved in
`evidence/genesis-form-attempt-1.json` and `genesis-form-attempt-2.json`.
Neither submitted or uploaded anything; both exhausted 12 model rounds.
Attempt 2 includes actual tool errors: select input reported immediate value
rejection; repeated malformed calls omitted a required string argument. The
first evidence's failure:null was an eval-reporting gap, not absence of failure.
The harness now retains SSE error text and individual tool failures.

The existing browser.fill now accepts an exact internal option value or unique
visible label, refuses ambiguous/disabled/missing options before mutation, and
checks retention against the resolved internal value without exposing typed
values. Unknown labels return bounded current option labels. Schema errors now
name the argument to correct without echoing input contents. No input validation,
consent rule or turn budget was relaxed. No task-specific selectors were added.
Actual local-browser regression passed, including ambiguous/disabled choices,
internal value retention and output privacy. First focused suite 35/0/0; shared
runner/host follow-up 32/0/0. This repair has NOT yet passed live Go acceptance.
Next attempt must use a fresh evidence path after deployment; preserve failures.

All three CI runs for exact 43003d3 verified successful: V4 40029142561,
Windows desktop 40029142247, runner 40029142289. This is hosted CI, not trusted
production signing or physical Ghost native-install acceptance. Overall NOT READY;
all earlier Genesis, persistent scheduler/push and release blockers remain open.

Attempt 3 on deployed 065711d926898268f9b2b3b3c366c3025431a907 is also FAIL:
real Go filled controls and uploaded the file, but no POST/receipt. Preserved
in genesis-form-attempt-3.json. It exposed an independent grounding defect:
GROUND_JS was an ordinary JS template, turning its whitespace regexp into
`/s+/g` at runtime. Anonymous button names containing s then failed the click
identity check. String.raw preserves the intended regexp. Actual browser test
now observes and clicks 'Register session', then changes the name and confirms
the next click is rejected without another action. Identity checks stay intact.
Checkbox expectations without expectSelector now bind to the actual clicked
selector/ref; they still run the existing read-only verifier. Real DOM checkbox
test passes. Browser/grounding/verification regression 49/0/0, plus updated
physical-DOM regression 1/0/0. No physical iPhone or live Go PASS from these tests.
No turn or tool budget was increased. Continue with a fresh live evidence path.

Attempt 4 on exact 37c0a25b561fc85ea5aa0276e5abb546f0a7283b is FAIL and
preserved in genesis-form-attempt-4.json: filled/uploaded/clicked but no server
submission. Failed operations include filling a checkbox and a malformed click
expectation. Twelve rounds exhausted honestly. The model now receives remaining
round/tool counts on each request, guidance to batch independent grounded calls,
re-observe changed identities and reserve outcome verification. Counts are not
reset or increased; the note is not accumulated in conversation history.
Agent failure/continuation/cancel/budget regression 15/0/0. Last controlled form
attempt is number 5; do not continue unlimited attempts or erase failures.
