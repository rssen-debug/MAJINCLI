# MAJIN V3 next actions — checkpoint

**Checkpoint date:** 2026-10-22 (Europe/Stockholm)
**Current branch:** `v3/main` (local, based on `origin/v2/main`)
**Latest verified source baseline before this round:** V1 `814459ea50fc86c5ac1aeed939ec9d2344dc5bfb`; V2 `b2533097ca3c744fa7e9b152b221a97186507835`.
**Latest verified V3 code/test commit:** `6b27fa6d93ce95d113569a408174ea4bfcbaaa05` (full suite and static checks pass).
**Current score target for this checkpoint:** see `PROGRESS.md` / `ACCEPTANCE_MATRIX.json`; only VERIFIED weights count.

## Current goal

Create an evidence-backed V3 foundation and vertical slice while protecting V1 `main` and V2 `v2/main`.

## Completed and verified in this round

- Read the repository and confirmed protected branch SHAs.
- Created a separate local `v3/main` from V2; there was no remote `v3/main` at initial inspection.
- Audited reusable V1/V2 code and researched upstream projects; see `SOURCE_AUDIT.md`, `REUSE_MATRIX.md` and `UPSTREAM_RESEARCH.md`.
- Implemented `src/v3/runtime/file-deliverable.js`, `src/v3/server.js`, `src/v3/ui/page.js` and `test/v3-vertical-slice.test.js`.
- Targeted V3 tests pass: 7/7 on Node 20.20.2; full post-change suite passes 1,183/1,202 with 19 environment-gated skips.

## Relevant files

- `src/v3/runtime/file-deliverable.js` — V2 Goal + verifier adapter; create-only workspace write.
- `src/v3/server.js` — loopback-only preview API.
- `src/v3/ui/page.js` — minimal no-CDN UI.
- `test/v3-vertical-slice.test.js` — unit/integration/security-focused tests.
- `docs/v3/` — audit, architecture, research, acceptance and evidence checkpoint.

## Immediate next steps

1. After rotating/revoking the credentials exposed in chat and configuring a secure GitHub auth path, push local `v3/main` without using the pasted token. The first push attempt was blocked because no username/credential was available.
2. Reconcile the Node support floor (`>=20.11` in the manifest vs `>=22` dependency warnings) with the Windows installer and CI.
3. Next engineering objective: adapt the existing V2 DAG/scheduler plus safe tool registry into a narrowly scoped V3 goal executor, starting with a second genuinely useful deliverable and an explicit cancellation/approval contract.
4. Keep the default UI minimal and add real Playwright DOM/browser acceptance before claiming rendered accessibility.
5. Continue the deep V1/V2 behavioral audit and Windows validation; update only evidence-backed acceptance weights.

## Outstanding blockers

- GitHub connector lookup returned unsupported. `GIT_TERMINAL_PROMPT=0 git push origin HEAD:refs/heads/v3/main` failed with `could not read Username`; remote `v3/main` is not published. No chat-pasted credential was used.
- User pasted provider/GitHub credentials into chat. Treat them as compromised and revoke/rotate immediately; they are not stored in V3 or used for any operation.
- Windows host is not available here, so Windows desktop, voice, installer and headed-browser acceptance remain blocked/not run.
- Node engine range mismatch: package says >=20.11 while installed dependencies request >=22.

## Exact verified score

18.00% verified (18.00 / 100.00); 82.00 points remain. Release remains NOT READY. No background process is running.
