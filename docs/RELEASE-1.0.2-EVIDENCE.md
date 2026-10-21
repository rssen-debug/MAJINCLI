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
