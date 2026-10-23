# MAJIN V4 release verification — 23 October 2026

Latest saved status: **NOT READY** — [final Ghost evidence](evidence/ghost-final-status.json).
The completed local V4 run passed 505/505 with no skips; it started at `526b0e6`
and received repairs during execution, so it is not represented as an immutable
latest-head run. Exact-code CI for `0dad743` passed 501/506 with five explicit
Linux browser/Windows-parser skips, parsed 617 sources and passed i18n; Windows
runner also passed. Windows desktop packaging was still running at observation.
The later owner-requested hero copy change has its own passing boot check and
needs its new head's CI. Legacy remains 1284 passed/0 failed/23 skipped.

The owner now approves Kokoro/am_adam and the English audio reply on iPhone 13,
but still reports latency. Actual synthetic English audio -> OpenCode -> verified
Kokoro WAV over Tailscale HTTPS succeeded in 11.266 seconds. Natural barge-in,
explicit 5G reconnect and complete physical voice acceptance remain unconfirmed.
Original 23 selected data/config/key/pairing files still match; six existing
sessions continue to see shared history. Desktop opening was not verified:
native installation is blocked, and browser automation's saved origin permission
still denied access after the owner gave renewed consent. No policy was bypassed.

Latest Ghost follow-up: **NOT READY**. See [Ghost acceptance](GHOST_ACCEPTANCE_20261023.md)
and [machine-readable evidence](evidence/ghost-acceptance.json). Backup/restore,
real inference, crash recovery, shared authenticated history and mobile input
repair are verified. Ghost legacy regression is now 1284 passed, 0 failed,
23 skipped (43 failures reproduced and repaired). The owner confirms mobile
chat works but rejects the first voice fallback's latency, Swedish language lock
and missing prior narrator. The follow-up restores existing Kokoro/am_adam, warm
local STT and language detection; physical voice acceptance is still failed/pending.
The new DOM module-list regression was corrected (18/18 targeted pass). Native
installation, login startup, production signing/updates and parity remain open.
The alpha.2/alpha.3 krist records below and the intermediate failures above are
historical snapshots; the latest evidence at the top takes precedence.

Latest tested candidate: **4.0.0-alpha.3** implements durable inline tool history using the existing server receipts. See [HISTORY_RECEIPTS_ALPHA3.md](HISTORY_RECEIPTS_ALPHA3.md) for installed-package verification, the 30/30 targeted tests, the 492-pass/1-fail full local run and the successful 12-test isolated rerun. Its installer and bundled-host history recovery passed on krist. The alpha.2 build identity and original failures below remain historical evidence, not claims about the newer package. Alpha.3 evidence is recorded separately; production status remains NOT READY.

## Verdict: NOT READY for the requested production release

The repository is accessible through the owner's GitHub connection. The work is on `codex/v4-final-integration-20261023`, with draft [PR #401](https://github.com/rssen-debug/MAJINCLI/pull/401) targeting `v4/main`. The initial Windows candidate was **4.0.0-alpha.2**; the tested alpha.3 follow-up is described above. No production release was published, no PR was merged, and no production signing identity or update channel was invented.

Initial alpha.2/alpha.3 development and local acceptance ran on **krist**, with owner authorization; Ghost was not connected then. The subsequent Ghost source-host work is documented above and does not retroactively establish native-package acceptance on Ghost.

## What changed

V4 continues to use the existing V1 adapters and V2 kernel/runner rather than introducing another agent core. Current V1 browser grounding, semantic/shadow-DOM handling, receipts, recovery and associated loop/UI changes were integrated. Existing V4 file-grant controls were retained. Failed and cancelled team nodes no longer become successful checkpoints, old failed checkpoints are ignored, graph dependencies pass verified artifacts, explicit empty tool lists remain empty, and member tool budgets are enforced.

Windows fixes cover file-URL imports, private-file ACL diagnosis, MCP broken pipes, plugin termination, child-process cleanup and supervisor restart/duplicate-instance behavior. Path grants resolve existing and new paths consistently through Windows 8.3 aliases. Local STT now uses the existing shell-free quoted argv executor, supporting `Program Files` executable paths. The hidden image modal no longer intercepts all UI clicks. Server and desktop version numbers share the package version.

The Windows application is an actual Electron window using the existing server UI. It has a persistent isolated session, sandboxed renderer without Node integration, restricted navigation/popups, file-save dialogs, saved monitor-aware bounds and a per-user NSIS installer. A separate bundled Node runtime starts the shared host so closing the window can leave the host available to mobile clients. The native menu exposes an owner-controlled login-start setting; actual Windows login acceptance is still pending. Testing did not enable permanent autostart on krist.

Packaging initially omitted the host's runtime dependencies. The installed cold-start test caught this; the package now includes an explicit host `node_modules` resource mapping. Earlier passing external-host tests alone were insufficient evidence of cold start.

## Evidence and limits

The machine-readable [test report](FINAL_TEST_RESULTS.json) separates overlapping suites, failures and blocked acceptance. [Functional parity](FINAL_FEATURE_PARITY.md) lists specific replacements and missing behavior; inventory counts do not establish parity.

* V4 regression before the last packaging/shutdown adjustments: **490 passed, 0 failed, 0 skipped**. Final full local run: **490 passed, 1 failed, 0 skipped** out of 491. The remaining failure was a browser-test time-of-check/time-of-use race between observing a verified card and reading its summary while history refreshed. The corrected browser check reads both atomically and also verifies the saved bytes; its separate result is recorded in the test report. This is not presented as a green final full run.
* Latest V1 browser regression: **131 passed, 0 failed, 5 skipped**. These include DOM and contract tests, not universal live browser acceptance.
* Full legacy root regression: **1,233 passed, 44 failed, 23 skipped**. It is not green. Failures include old version/tool-count assumptions, Windows/POSIX assumptions and older voice/V2 fixtures. They have not all been classified as harmless.
* Live provider test: existing krist **OpenCode / glm-5.3**, streaming, actual tool execution, file byte verification. The dependent graph test used **8 model calls with peak concurrency 2**. See `evidence/live-model.json` and `evidence/live-orchestration.json`. Credential contents were neither recorded nor changed; test conversation data was isolated.
* Actual Windows control acceptance: synthetic Win32 window listing, typing, reading, button/save, pointer movement/restoration, cropped capture and visible pixel/overlay checks passed. The computer-use planner was injected; cloud desktop planning was not verified. See `evidence/windows-control.json`.
* Chromium UI acceptance passed at iPhone 13, Pixel 7, iPhone SE, iPad and desktop viewports, including pairing/chat/verified file flow. These were simulated viewports, not physical devices, Safari or a 5G connection. See `evidence/browser-run.json`.
* Original alpha.2 installer, installed native-window and packaged cold-start results are in `evidence/windows-install.json`, `evidence/desktop-smoke-alpha2.json` and `evidence/desktop-cold-smoke-alpha2.json`. The unversioned smoke evidence now describes the current alpha.3 candidate. Inference in those tests was explicitly demo. Upgrade data preservation was tested using a disposable sentinel file.

## Production blockers

1. Ghost backup/restore, preserved configuration, source-host inference/history and child crash recovery are verified. Native installation and actual login startup remain unaccepted; failed scheduled task is disabled while the manual supervisor runs.
2. Real iPhone chat over Tailscale is owner-confirmed. Physical microphone/speaker, natural voice interruption, explicit 5G reconnect and the remaining device/upload walkthrough are pending; a new iOS recording/server STT path must pass physical acceptance.
3. The installer is an **unsigned test artifact**. A pinned trusted production signer/channel is absent. Existing signed host update tests use disposable keys; they do not establish production trust.
4. Signed host updates do not replace the running Electron shell. Native-shell automatic update activation and rollback remain unimplemented.
5. Functional gaps remain for outbound channels, proactive event digests, separate-store memory synchronization, some typed self-configuration/reset behavior, V2 cryptographic audit anchoring, durable graph pause/replanning and whole-team token/currency accounting. See the parity table. Scanned-PDF OCR is unsupported.
6. Historical krist legacy result was 44 failures. Ghost reproduced 43 failures; repairs yielded 1284 passed, 0 failed, 23 skipped. The last full local V4 had one installer text assertion failure, subsequently corrected and verified in 15 targeted tests. Latest CI must be evaluated for the actual PR head, not an earlier commit.

Closed in alpha.3: the inline-history receipt gap. Both opening and refreshing a conversation render durable server receipts, with visible historical labels, original times, and no assertion of current file existence. Physical target/device verification remains separate.

## Initial alpha.2 build identity

The initial alpha.2 installer contains runtime source matching GitHub commit `99d55a29b452e5d8f050b5cf70581de2c5ccd739`. The local and uploaded source tree hashes were verified equal. Installer SHA-256: `82f239635fb267f228f2aed2d9c3abec65f985a0cda226080fca92ad91317b06`. Size: 138,438,415 bytes. Bundled Node: 24.14.0 x64, Authenticode Valid. Installer Authenticode: NotSigned. See `evidence/build-provenance.json`. The alpha.3 package has its own source/hash record in the follow-up report.

## Single target handoff

Continue on this branch with Ghost's existing source host, provider, private backup
and supervised local audio worker. Preserve keys, data and original installation.
Resolve latency/physical interruption/reconnect, actual login startup, approved
signing/native installation, production host and Electron update/rollback and all
explicit parity gaps. Evaluate CI for the actual final head. Publish only after
those gates have concrete evidence; the working source alpha is not a READY release.


## Genesis continuation checkpoint (2026-10-23) — NOT READY

Handover is tracked in `HANDOVER_CONTINUE.md`. Streaming narrator milestone
`fffa918` is deployed and explicitly enabled on the source host. Authenticated
Tailscale HTTPS delivered two WAV segments (first 4301 ms, complete 7758 ms);
this is a synthetic text benchmark, not a physical phone PASS. Original 23
config/key/pairing/history files still matched backup hashes; 39 restored files
had zero mismatches. Native Windows app remains separately unaccepted.

The next verified code milestone adds canonical durable model selection with
stale-version conflicts, endpoint-bound cost authorization and no model fallback;
search/included filter/cost warnings; exact Go/Zen endpoint identity; preservation
of last verified catalogue on failed refresh. The existing owner Go route remains
usable. Unknown account billing is explicitly `Cost unknown — verify with provider`.
Do not infer subscription inclusion from a gateway, token price or model listing.
Focused model/selection/client-DOM tests: 40/0/0. Controlled Edge and WebKit
selector tests: 2/0/0. These are not live Go or physical device acceptance.

At commit 930e2fb V4 CI and Windows runner passed; Windows desktop was cancelled.
Latest-head CI, canonical-selector production deployment, actual Go entitlement,
two-model switching, real-model scenarios A–G, persistent monitoring and locked
physical iPhone push, voice interruption/reconnect, production signing, login
startup, native installation/update/rollback and every original parity gap remain
gates. PR 401 stays draft/open; no production release or merge is justified.
