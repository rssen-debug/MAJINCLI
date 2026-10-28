# Windows continuation — 2026-10-28

Baseline: main at `9b9a272` (merged PR #479). The installed pinned V6
checkout, V5 grants, existing runtime state and the dirty multi-preview
checkout were preserved. No MAJIN/OpenCode service was restarted.

## Reproduced blocker and fix

`powershell.exe -NoProfile -ExecutionPolicy Bypass -File
scripts/v6/start-v6.ps1 -Action Doctor -DryRun` failed on Node 24.20.0:
the launcher passed PowerShell's `-ge` operator to JavaScript, then incorrectly
reported that Node was too old. Parse `node --version` in PowerShell instead.
ExecutionPolicy is scoped to the test process, as in the existing launcher workflow.

## Evidence

- Baseline `npm.cmd run v6:test`: 48 passed on Windows / Node 24.20.0.
- Updated `npm.cmd run v6:test`: 49 passed, zero skipped or failed.
- The new Windows PowerShell 5.1 regression test fails with the original
  launcher and passes with the fix. It uses paths containing spaces and
  checks that dry-run neither creates V6 state nor changes V5 grants.
- Real local integration: MCP tool execution, receipt replay, lane denial,
  worker file writes and restart without duplicate execution passed.
- Gmail/provider fixtures are simulations, not live-account acceptance.
- Added CI matrix: Windows and Ubuntu, Node 22 and 24. Remote results must
  be checked on the PR; local success is not evidence of CI success.

## Remaining work

- OpenCode Go / DeepSeek Flash: **BLOCKED** by the owner's reported weekly
  quota. No provider call or paid fallback was made by this change.
- Live Teamtailor, real CV submission and Gmail confirmation: **NOT VERIFIED**.
- PR #443 and #444 were open and mergeable when inspected. PR #445 was open
  with a merge conflict. None was merged during this change.
- The local multi-preview checkout contains uncommitted memory, job-verification
  and dashboard work. Inspect and preserve that work before any consolidation.
- Provider budgeting, caching, configurable providers and the submission
  adapter remain separate development tasks; this change does not claim them.
