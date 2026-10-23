# MAJIN V4 — continuation handover

Status: **NOT READY**. Latest pushed product milestone before this follow-up: `8ab843422f1a74cbce6bd350e7a0131d7b3ac9f8`. Initial handover: `f62e6f6f9d27d16e63228125cb041e129324d437`. Use `git rev-parse HEAD` for this updated milestone identity.
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
