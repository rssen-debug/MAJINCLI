# MAJIN V4 — continuation handover

Status: **NOT READY**. Handover first pushed in `f62e6f6f9d27d16e63228125cb041e129324d437`; product starting point `930e2fb121451a120b87a193110d55002a85807e`.
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
commit config/auth values. Go is NOT Zen: current official documentation uses
`/zen/go/v1` for Go and `/zen/v1` for metered Zen. Shared hostname/model names do
not establish an entitlement. Verify current official documentation and actual
metadata; unknown billing must say “Cost unknown — verify with provider”. No
automatic paid fallback. Existing selector is per-conversation, lacks billing
and search/filter controls, and is not yet the requested canonical model setting.

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
PWA shell 9 prevents old client code remaining cached.

Focused voice tests: 25 passed, 0 failed, 0 skipped. Synthetic loopback benchmark
in `evidence/ghost-voice/stream-latency.json`: first audio 4270 ms, stream completion
13503 ms (three segments), whole-WAV comparison 11563 ms, identical text/model.
Kokoro create_stream alone gave one batch for a normal reply; sentence-sized
inference units fix that first-audio bottleneck. This does NOT measure iPhone
end-to-end latency or prove physical interruption. The production worker and host
still need fast-forward deployment, explicit activation and HTTPS verification.
Temporary test worker on loopback 18766: identify exact command/PID before stopping.

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

P1: Go/Zen identity, verified pricing/entitlements and timestamps; shared durable
model selection with stale-update conflicts; compact search/included filter,
cost warnings and server-side paid-route authorization. Catalogue failure must
preserve last verified data/configuration, with a stale label. Never infer FREE.

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

Inspect installed Kokoro `create_stream` and test on 18766; measure first segment
vs complete WAV for identical text/model/settings. Stop only that isolated worker
after verification. Then finish/push this milestone, update handover and proceed
to P0/P1 instead of repeating unchanged full suites.

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
