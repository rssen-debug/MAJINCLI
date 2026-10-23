# MAJIN V4 release verification — 23 October 2026

## Verdict: NOT READY for the requested production release

The repository is accessible through the owner's GitHub connection. The work is on `codex/v4-final-integration-20261023`, with draft [PR #401](https://github.com/rssen-debug/MAJINCLI/pull/401) targeting `v4/main`. The Windows candidate is **4.0.0-alpha.2**. No production release was published, no PR was merged, and no production signing identity or update channel was invented.

Development and local acceptance ran on **krist**, with owner authorization. **Ghost was not connected**: its installation path was absent and its private Tailscale hostname did not resolve. GitHub access did not provide Ghost access.

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
* Installer, installed native-window and packaged cold-start results are in `evidence/windows-install.json`, `evidence/desktop-smoke.json` and `evidence/desktop-cold-smoke.json`. Inference in those tests was explicitly demo. Upgrade data preservation was tested using a disposable sentinel file.

## Production blockers

1. Ghost installation/configuration, backup, migration, actual login startup and crash recovery have not been accepted on the target. Existing data, sessions, trust and credentials require preservation before installation.
2. Real iPhone/Android, private networking, 5G reconnect, uploads/history sync and physical voice acceptance remain unverified. Automatic voice barge-in is absent; browser recognition needs a configured fallback where unavailable.
3. The installer is an **unsigned test artifact**. A pinned trusted production signer/channel is absent. Existing signed host update tests use disposable keys; they do not establish production trust.
4. Signed host updates do not replace the running Electron shell. Native-shell automatic update activation and rollback remain unimplemented.
5. Functional gaps remain for outbound channels, proactive event digests, separate-store memory synchronization, some typed self-configuration/reset behavior, V2 cryptographic audit anchoring, durable graph pause/replanning and whole-team token/currency accounting. See the parity table. Scanned-PDF OCR is unsupported.
6. The 44 legacy test failures remain unresolved. Latest CI must be evaluated for the actual PR head, not an earlier commit.
7. Rehydrating the conversation history currently renders messages without their transient tool cards. Receipts remain on the server, but their inline history presentation needs completion. The browser test's atomic read does not fix or conceal that UI limitation.

## Build identity

The installer contains runtime source matching GitHub commit `99d55a29b452e5d8f050b5cf70581de2c5ccd739` (later commits contain test/evidence updates only). The local and uploaded source tree hashes were verified equal. Installer SHA-256: `82f239635fb267f228f2aed2d9c3abec65f985a0cda226080fca92ad91317b06`. Size: 138,438,415 bytes. Bundled Node: 24.14.0 x64, Authenticode Valid. Installer Authenticode: NotSigned. See `evidence/build-provenance.json`.

## Single target handoff

Open this project on Ghost, connect its private network and run the same installer/host verification with its existing configuration after a verified backup. Preserve the owner-selected provider settings and trust material. Then run physical phone/voice/reconnect acceptance, provision the approved production signing identity/channel, complete native-shell update/rollback and the explicit parity gaps, and resolve the legacy suite. Publish only after those gates have concrete passing evidence. Until then, use this as a local alpha candidate, not the promised final Godmode release.
