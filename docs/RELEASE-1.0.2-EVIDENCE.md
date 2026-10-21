# MAJIN v1.0.2 — interactive desktop patch release

This release contains fixes discovered by executing MAJIN on a connected, interactive Windows self-hosted runner. It replaces the earlier v1.0.1 verification boundary; it does **not** claim exhaustive automation across arbitrary third-party Windows applications.

## Evidence (actual interactive Windows runner)

- GitHub Actions run: https://github.com/rssen-debug/MAJINCLI/actions/runs/39586059993
- Result: **SUCCESS** (not a hosted Session-0 assumption).
- W11: real MAJIN Win32 `control.list_windows`, `control.type`, `control.read`, `control.click_button` on an isolated synthetic Windows Forms window; saved file's bytes verified.
- MAJIN `computer.use`: model-driven observe → plan → Win32 act → independent verify, with its guard/allowlist and bounded steps.
- OpenCode Go: genuine remote Go model planned the actual synthetic window actions, wrote and verified the expected text and saved bytes. No local Qwen on the user's PC.
- W12: pixel sampler independently saw the temporary synthetic form, then the real pink overlay appear, move to a second target, update its label, and disappear. **No full-desktop screenshot was retained or uploaded.**
- Final workflow log: `W11 SYNTHETIC GUI PASS`, `W11 COMPUTER.USE LIVE ENGINE PASS`, `W11 REAL GO COMPUTER.USE PASS`, `W12 REAL PIXEL PASS`, `OWNER_DESKTOP_VERDICT status PASS`.

## Fixed in this patch

- Run Win32 control bridge as a direct PowerShell process rather than nested command parsing.
- Recognize standard Windows Forms EDIT and BUTTON controls.
- Correct UTF-8 PowerShell source encoding and diagnostics; byte-accurate synthetic QA readback.
- Keep pink WinForms overlay attached to the real interactive session; fix Add_Paint event handling, display position, and visibility.
- Wire guarded `computer.use` to a real cloud model planner, reject unverified `done` claims, restrict actions to known safe Win32 control capabilities, require independent verification.
- New real-device, nonintrusive self-hosted Windows acceptance workflow.

## Limits

- These proofs cover a synthetic GUI fixture in an actual Windows session, **not** all third-party applications, arbitrary screen coordinate interaction, screen vision recognition, or end-user Windows upgrade delivery.
- The user may need to install/update this version to run the newly fixed code; a QA runner checkout alone does not install the release onto the user's computer.
- Release publication requires green PR CI and main branch `build-exe`, with actual installer artifacts and SHA-256 checksums.
