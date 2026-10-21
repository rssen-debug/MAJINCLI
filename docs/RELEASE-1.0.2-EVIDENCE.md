# MAJIN v1.0.2 release evidence and limitations

Source baseline: main at 403424913dafa0f1623dc265bdc52832d8947107, after PR #211.

## Scope

- Restore-safe GRAND ARCHITECT checkpoints: re-check current file contracts and recorded artifact digests; do not carry stale or modified artifacts.
- Bind resumable work to exact task instructions and dependencies; reject stale node-ID reuse.
- Fail closed with REQUIRES_REVIEW for carried steps that cannot be independently verified without re-executing unknown side effects.
- Retry external Ollama model download errors at most three times in the real free-model CI gate; preserve red result if the model cannot be fetched.
- Bump package, lockfile, runtime literal, installer default, and publish script to 1.0.2 consistently.

## Required release proof

1. v1.0.2 PR gates green: syntax/full Node tests, live OpenCode Go, Windows GUI/installer, free-model acceptance, and build-exe.
2. Exact merged main commit verified. New main build-exe must pass before declaring the release usable.
3. Newly created public GitHub release v1.0.2 with MAJIN-Setup.exe, majin-win-x64.exe and both respective .sha256 checksums.
4. Do not mistake the previous v1.0.1 assets for freshly built v1.0.2 artifacts.

## Interactive Windows evidence — precise scope

The self-hosted runner MAJIN-INTERACTIVE-01 (2026-10-21, run 39584274075) was confirmed in an interactive Windows session and executed real MAJIN control.list/type/read/click against a disposable QA window with verified saved bytes; it also observed the W12 pink overlay appear, move and hide in actual screen pixels (only synthetic QA pixels sampled, no desktop screenshot uploaded). These are real limited-scope tests, not a generic autonomous desktop task.

**Still NOT VERIFIED without separately grounded evidence:** autonomous agent-to-GUI end-to-end completion using a real cloud model on the owner's PC, arbitrary third-party desktop apps, update-over-old-installed-binary on the owner's device, and every provider/model/account combination. CI test coverage is not a blanket 100% certificate.

## Verified interactive Windows desktop fix scope

- On the self-hosted Windows desktop runner, real WinForms list/type/read/click/save for a disposable QA app; saved bytes read back exactly.
- MAJIN computer.use executes a bounded OBSERVE→PLAN→ACT→VERIFY chain on that disposable window, both with a deterministic test planner and with actual OpenCode Go model inference. Real cloud model chooses actions; test checks the saved QA file.
- Pink overlay pixels are sampled in-memory in a small region and proved to appear, move, update label state and disappear; no private screenshots or unrelated window titles uploaded.
- Reference owner-PC workflow: https://github.com/rssen-debug/MAJINCLI/actions/runs/39586059993 (earlier Go+pink PASS). Follow-on complete cloud+W11+W12 success workflow: https://github.com/rssen-debug/MAJINCLI/actions/runs/39586059993 should be supplemented by current branch interactive QA run.
- Only synthetic QA app and basic Win32 Edit/Button controls verified. This DOES NOT prove universal arbitrary app navigation, user-file manipulation, or unsupervised high-impact actions.
