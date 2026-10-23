# Final feature parity audit — MAJIN V4

**24 October Ghost checkpoint — NOT READY:** installed `527b021d8077d1aabf1ea8ef7bb764d3caaf58ca`.
All five real Go unknown-form attempts failed and are preserved, with zero server
submissions. Browser repairs and bounded model guidance pass focused regressions;
they do not establish universal autonomy. Canonical selection and the earlier
real Go approved tool continuation remain verified within their recorded scope.
See [current release checkpoint](FINAL_RELEASE_REPORT.md) and
[machine-readable evidence](evidence/genesis-form-checkpoint.json). Every original
parity row and Genesis gate below remains in scope. Persistent scheduling/Web
Push, production signing/update activation/rollback, full physical acceptance,
two eligible models/billing protection and real-model scenarios remain open.
Older 'pending'/'latest' paragraphs below are dated historical observations.

Audit date: 2026-10-23. Target: `v4/main`, integration PR [#401](https://github.com/rssen-debug/MAJINCLI/pull/401).

**Current Ghost delta — NOT READY:** [Ghost acceptance](GHOST_ACCEPTANCE_20261023.md)
records verified backup/restore, live provider, crash recovery, shared history,
CLI migration and owner-confirmed mobile chat repair. The owner reports Safari
microphone failure; the new recording/local STT path is not physically accepted.
Production signing/native installation, login startup, updates and the functional
gaps below remain requirements. Initial krist-only paragraphs are historical.
V2 permission hardening adds one inventory component; the STT path reuses that
privacy helper (now 22/52 imported). It does not wire V2 cryptographic audit into V4.

Latest [final evidence](evidence/ghost-final-status.json): owner approves the
restored Kokoro/am_adam voice and English reply; latency remains unsatisfactory.
Synthetic complete HTTPS audio/model/audio roundtrip succeeded in 11.266 s.
Exact `0dad743` CI passed (501/506, five platform/browser skips), while the local
completed run passed 505/505 across an actively repaired checkout. No original
functional requirement is waived by these results. The owner-requested start
screen now says only “Majin lets run it.” and removes the three suggestion chips;
its boot check passes. New-head CI and full release gates remain separate.

Source snapshots actually fetched:

| Version | Branch | Commit |
|---|---|---|
| V1 | main | e84b716e79ac4fc3cb443280e56d3f12553c8fc2 |
| V2 | v2/main | 1ef253fb1f44406c262a290e170902403f68cceb |
| V3 | v3/main | df678b21dfb784233da8cea25bdc54722a61236a |
| V4 base | v4/main | 588dcbb52bf6672f20dc901155181b595bb8156f |

## Scope and evidence rules

The initial audit ran on Windows as `krist`, when Ghost was unreachable. Its tests used isolated homes except authorized live provider checks. The subsequent Ghost audit above verifies actual backup/restore, source-host configuration, OpenCode inference and Tailscale access; it does not claim native distribution or physical voice acceptance.

The generated [component inventory](CAPABILITY_INVENTORY.md) records every V1 tool module and V2/V3 component, including excluded modules. It currently identifies 141 V1 tools, 111 adapted tool definitions, 30 excluded tools, and 22 of 52 V2 components imported. These counts are implementation inventory, **not proof of functional parity**. Registered capabilities still depend on host availability and explicit owner grants.

V2 adjustments cover doctor compatibility, shell-free quoted STT execution, Windows audit-file ACL protection and OpenSSL timestamp executable/CRLF compatibility. The privacy helper is reused for temporary STT audio; cryptographic V4 audit integration remains missing. V3 source matches its fetched branch. V1 browser grounding, receipts, semantic/shadow DOM handling, verification and recovery were integrated through existing adapters; V4 filesystem grant guards remain.

## Functional comparison

“Windows test” means actual local execution on krist or a named automated test. “Mobile API” means the shared server exposes the function; it does not mean physical iPhone acceptance. PARTIAL is deliberately not equivalence.

| Capability | Existing implementation | V4 use/replacement and equivalence | Windows evidence | Mobile availability | Exact outstanding work |
|---|---|---|---|---|---|
| General-purpose tools | V1 src/core/tools | V4 tools/host.js adapts V1 definitions to V2 runner; equivalent for adapted tools | host-tools.test.js; capability inventory | Same server registry | Exercise every granted external integration with its real service |
| Discovery/activation | V1 meta.js | V4 tool-exposure.js searches and activates live definitions; equivalent | tool-exposure.test.js, universal-agent.test.js | Yes, through chat | Live-model discovery walkthrough on Ghost |
| Desktop observation and controls | V1 wincontrol.js, net.js | Existing implementations through V4 lanes; shared approvals | Actual synthetic Win32 window: list/type/read/button save, mouse restore, cropped PNG and pixel checks passed | Server-side execution from authenticated requests | Repeat through V4 with real inference on Ghost; verify locked-desktop refusal |
| Computer-use loop | V1 computer-use.js, computer tools | Reused, no second core | Actual OBSERVE/PLAN/ACT/VERIFY loop passed with injected planner; cloud planner untested | Owner-granted lane | Live provider planning and cancellation on Ghost |
| Browser navigation/read/click/fill/upload | V1 browser.js + web.js | Reuses Node CDP transport; imports latest V1 browser improvements | 131 browser tests passed, 5 skipped; many are DOM/contract tests | Owner-granted browser lane | Real V4 model-driven browser upload/cancel walkthrough |
| Browser runtime discovery | V1 existing Edge/Chrome + Node CDP | Fixed false rejection when SESSIONNAME is absent; no Playwright runtime dependency needed | host-tools tests; local browser detection | Execution stays on Windows | Verify installed Edge and interactive session on Ghost |
| Filesystem access | V1 files.js | V4 folder grants and path-access guard wrap reused tools | file-access.test.js, acceptance folder search | Yes, restricted to granted folders | Physical Ghost folder-grant walkthrough |
| Shell/PowerShell | V1 exec.js and shell.js | Both surfaces adapted; process-tier approvals retained | host-tools.test.js, permission refusal tests | Yes, approved on client | Live allowed command and cancellation on Ghost |
| MCP | V4 mcp.js/mcp-tools.js | Reused; fixed Windows pipe errors and failed-process handling | Real stdio fixture handshake, calls, failures and scrubbed environment tests | Same approved tool bus | Real installed CUA-driver/MCP configuration on Ghost |
| Skills | V4 skills.js + shipped SKILL.md files | Preserved; discovery depends on real tool requirements | skills.test.js | Same chat/runtime | Validate owner-installed skills on Ghost |
| Plugins | V4 kernel/sandbox | Preserved; fixed file URL imports and awaited child shutdown | Actual child-process plugin tests, quarantine, timeouts and cancellation | Tools use shared backend | Validate configured real plugins; same-user isolation is not an OS sandbox |
| Conversation history | V4 store/server/UI | Single canonical server store; preserved | conversation.test.js, history-sync.test.js, client-dom.test.js | Create/rename/search/archive/restore/confirmed delete | Physical phone/Windows walkthrough |
| Reconnect and request deduplication | V4 turns.js/session.js | Preserved journal/replay and stable IDs | turns/resume/history-sync/client tests | Yes | Cellular suspension and Safari reconnection |
| Durable inline tool history | Existing V2 goal receipts, V4 conversation history | Alpha.3 returns safe receipt metadata and renders each recorded tool result after reload or cross-device refresh; no second store | Two authenticated sessions plus host restart; DOM failure/unverified/XSS checks; five Chromium reloads; installed alpha.3 bundled-host cold start | Same server receipts and PWA renderer | Physical mobile and Ghost acceptance remain separate; historical verification is explicitly labelled and does not imply current file existence |
| Memory | V1 memory + V4 memory.js | V4 canonical server memory replaces per-client copies; equivalent for one-host multi-client memory | memory.test.js | Shared server memory | Inspect/migrate actual owner memory on Ghost after backup |
| Persistent teams | V1 TeamStore/runTeam/runSwarm | Reused with V4 leaf workers; corrected failure checkpoints, cancellation, dependencies and artifact forwarding | orchestration and orchestration-recovery tests | Same chat and /api/teams | Live-model team acceptance and conflicting simultaneous same-team runs |
| DAG orchestration | V2 TaskGraph/runGraph | Reused with V4 leaves; failed action cannot become successful merely because it returned text | orchestration/recovery tests | Same agent_graph tool | Persistent graph pause/resume/replanning UI remains PARTIAL |
| Permission isolation and costs | V4 bounded subagents | Empty explicit allowlist now means zero tools; per-member tool reservations enforced | universal-agent and orchestration tests | Same policies | Token/currency accounting across an entire reusable team remains PARTIAL |
| Checkpoints and recovery | V1 team checkpoints; V2 goals/receipts | Successful team nodes checkpoint; failed/cancelled nodes rerun; goal resume re-verifies artifacts | orchestration-recovery/resume/crash tests | Server-side state | Coordinate concurrent runs of the same checkpoint and durable graph replanning |
| Output verification | V2 verifiers and receipts | Reused by V4; file hash evidence retained | conversation/kernel/integration and actual desktop saved-byte tests | Verified results in shared UI | Real external-service effects require service-specific live evidence |
| Provider routing | V1 transports + V4 config/model catalog | Preserved routing, headers and streaming | Authorized actual OpenCode/glm-5.3-flash on Ghost: file write/read, graph 8 calls/peak 2, inference after restart | Server-only credentials | Remaining configured-service walkthroughs; do not infer every adapter works from one provider |
| Voice recognition/TTS | V1/V2 engines; V4 browser capture and voice API | PARTIAL: iOS getUserMedia/MP4 recording and configured local server STT; other browsers retain Web Speech fallback; browser synthesis | 35 targeted passes/1 Windows WebKit media skip; real Ghost AAC/MP4 HTTP transcription of synthetic Swedish speech via Tailscale | New iOS path deployed in source host | Owner's physical Safari microphone/playback and Windows/Android audio; latency/echo/battery measurements remain |
| Voice interruption | Foreground capture VAD, cancelSpeech and task interruption | PARTIAL: sustained voice energy cancels synthesis/active turn; bounded foreground session | Actual browser encoding plus VAD/cleanup tests and controlled iOS client synthesis/recognition stubs | Requires an explicitly started foreground microphone session | Measure natural speech/noise/echo rejection and real speaker interruption on iPhone/Ghost; no physical PASS |
| Text/code/CSV | V4 uploads/extract and V1 filesystem | Upload, extraction, editing and download; equivalent for text workflows | uploads/extract/file-access tests | Shared attachments/downloads | Large-file and physical-device checks |
| PDF/DOCX/XLSX | V4 extract.js | Extracts DOCX/XLSX containers and supported PDF text streams; partial PDF encodings are reported | extract.test.js | Upload, extraction, output download | Scanned PDF OCR is unsupported; select/configure an OCR provider rather than treating upload as understanding |
| Previews | V4 uploads and UI | Images/PDF/HTML and attachment cards; document text extraction | uploads/client-dom tests and browser screenshots | Same UI | Rich native DOCX/XLSX previews are PARTIAL |
| Windows desktop app | V1 Edge/Chrome --app launcher | Replaced by actual Electron BrowserWindow hosting existing V4 UI; not a browser shortcut | Actual alpha.2 per-user upgrade/data preservation, installed executable pairing/chat/file and bundled-host cold start on krist | N/A | Sign installer; physical voice, DPI/multimonitor and Ghost acceptance |
| Mobile PWA | V4 manifest/service worker/UI | Preserved shared UI; fixed hidden modal intercepting clicks and bumped shell cache version | Five real Chromium viewport flows, screenshots | Yes | Real Safari/Android and 5G tests remain BLOCKED |
| Notifications/background workflows | V1 sys.notify/flows/heartbeat | PARTIAL: notify/flows adapted; supervisor is not a replacement for proactive event digests | Existing tool contracts | Server events/progress | Port V1 heartbeat/event subscriptions to V4 lifecycle; add mobile push where authorized |
| Auto-start and crash recovery | V1 Scheduled Task settings; V4 supervisor | Existing supervisor preserved | Actual Ghost forced child crash recovered; installer contracts pass. Scheduled task failed and is disabled; manual supervisor restored | Running source host available to both clients | Diagnose scheduled task launch and prove actual Windows login startup; crash recovery is already verified |
| Signed host updates | V4 updater/supervisor | Existing Ed25519 manifest/hash verification, journal, health and rollback preserved | updater/release-flow/update-auto process tests using disposable signing keys | PWA served from updated host | Pin the owner's trusted production identity/channel; test real release on Ghost |
| Native app updates | New Windows shell | NOT EQUIVALENT to the host updater: host updates do not replace a running Electron executable | Installer build only | N/A | Add verified native-shell update activation/rollback with the approved production signing identity |
| Backup/rollback | V4 backup/updater plus private target snapshot | Existing backup/update rollback retained | Ghost full private backup: 39 data files restored byte-identically, 839 source snapshot files checked, Git bundle includes stash; 23 original live files unchanged | Server-owned data | Prove real signed production update activation/rollback; existing backup proof does not establish release rollback |
| Security and approvals | V2 approvals + V4 sessions/owner mode | Preserved; renderer sandbox/isolated context, restricted navigation and audio prompt; Windows ACL diagnostics corrected | security/owner-mode/sandbox tests; native renderer preferences inspected | Same authentication/CSRF/grants | Production ACL audit, signer pinning and installed-target review |
| V3 file deliverable slice | src/v3/runtime/file-deliverable.js | Replaced by workspace_write plus V2 verifier/receipts; functionally equivalent without importing the V3 server | Integration, artifact and actual file-byte tests | Same UI/download API | No separate V3 runtime required |

## Explicit legacy gaps — no silent exclusion

| Legacy capability | Current V4 position | Required resolution |
|---|---|---|
| Outbound Discord/Slack/Matrix/email/webhook channels | V1 channels.js is excluded; a PWA is not equivalent to those integrations | Adapt owner-configured channels to V4 sessions/tasks and external-action approvals; validate with the relevant accounts; assess separate inbound Telegram/WhatsApp modules independently |
| Proactive heartbeat/event digests | V1 heartbeat.js is excluded; process supervision does not deliver event digests | Reuse the event digest engine with V4 events and an owner-selected delivery route |
| Two-store memory delta synchronization | V1 memory-sync.js excluded; canonical single-host memory covers clients, not separate-store exchange | Add an explicit approved cross-store import/sync workflow with tombstone handling, or obtain an explicit scope decision |
| Agent self-configuration | V1 majin.js edits V1 config; V4 setup/owner mode cover only part of it | Implement typed V4 configuration changes with validation/approval; never point old tools at the wrong runtime |
| V1 reset/cleanup actions | Old runtime-wide reset excluded | Provide a V4 preview/backup/confirmed-reset flow for the corresponding persisted state |
| V2 cryptographic audit anchors/timestamps | Plain V4 receipts/telemetry do not provide equivalent hash-chain anchoring | Integrate the V2 audit chain and configured identity/anchor lifecycle, then verify exported bundles |

Overall parity status: **NOT COMPLETE**. “Excluded with a reason” is not accepted as a substitute for equivalent useful behavior. These gaps remain release blockers under the owner's requested definition of 100%.

## Desktop packaging decision

V1 src/cli/majin.js launches an installed Edge/Chrome using --app. It does not produce the required independent desktop package. Electron was selected to reuse the exact server-served UI while providing a maintained native window, persistent isolated session, standard file dialogs, high-DPI window behavior and a Windows installer. Its larger startup/memory footprint is a tradeoff; this audit does not claim a measured startup advantage over WebView2/Tauri.

The renderer has no Node integration, enables context isolation and sandboxing, restricts navigation/popups and prompts for same-origin audio. These controls follow the [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security/). The per-user assisted installer follows [electron-builder NSIS options](https://www.electron.build/docs/nsis/). The packaged host uses a separately bundled signed Node executable, so plugin/MCP child processes do not depend on Electron-specific environment flags.


## Genesis continuation — explicit acceptance status (2026-10-23)

These additions retain every original parity row above. No new capability is
considered complete merely because unit tests pass.

| Requirement | Status | Evidence / exact remaining work |
| --- | --- | --- |
| Shared durable model selection | PARTIAL | Versioned V4 store, endpoint-bound cost authorization, two-client conflict/restart/HTTP routing tests, Edge + WebKit mobile/desktop UI tests; deployment and physical clients pending at this milestone |
| Go versus Zen / catalogue metadata | PARTIAL | Exact endpoint identity, stale catalogue preservation, optional source/time/context/tool metadata; actual account entitlements and limits unverified |
| Included model default / two eligible Go models | BLOCKED | Working owner Go route preserved; other model costs require verified entitlement or explicit authorization. No fabricated FREE/included label |
| Model search / included filter / cost warning | PARTIAL | Two real local browser engines pass; included filter intentionally empty for unknown entitlement; physical app acceptance open |
| Sentence-streamed narrator | PARTIAL | Same Kokoro/am_adam deployed at fffa918; loopback first segment 4270 ms vs full WAV 11563 ms; authenticated HTTPS first segment 4301 ms. Synthetic, not physical timing |
| Physical mobile voice/interruption/reconnect | PARTIAL | Owner approved voice and English audio; natural interruption and explicit 5G reconnect remain unconfirmed |
| Real-model scenarios A–G | PARTIAL | Existing real Go write/read and orchestration evidence; unfamiliar dynamic form/upload, build/repair, research, desktop planning, restart/resume, physical mobile execution and two-model acceptance remain |
| Persistent natural-language monitoring / schedules | FAIL | Existing core scheduler/heartbeat must still be connected end-to-end to V4 with durable conditions/dedup/budgets/edit/pause/restart tests |
| Locked-iPhone Web Push chain | FAIL | Subscription, secure delivery/history/deep link, controlled threshold, real source and actual locked physical iPhone receipt remain unimplemented/unverified |
| Original Windows release / parity gates | BLOCKED | Production signer/channel absent; native activation/rollback and login acceptance outstanding; retain all original gaps above |


Approval continuation remains PARTIAL until the live retest. Deterministic
regressions now prove original model/batch context survives one-use approvals
and disk reload/boot, prior actions do not repeat, budgets do not reset, invalid
checkpoints execute nothing, and continued work can be cancelled from the UI.
Actual owner-authorized tool activation: 63 tools; this count alone is not PASS.
Canonical selection now has deployed real Go write/read and restart evidence
(`ghost-model-selection.json`), while physical selectors, two eligible models,
account billing protection and every other Genesis gate remain open.


At 01c97b4, real Go host-tool discovery/approved continuation completed with one
successful receipt per action and independent OS/CPU-file verification. This
closes that specific continuation defect, not the whole autonomy gate. Exact-head
Linux/Windows/runner CI passed. The next browser isolation/resource-cleanup and
reusable live-evaluation follow-up has deterministic and actual local-process
fixtures; real Go unknown-form acceptance is still pending. Persistent monitoring
and locked-iPhone Web Push remain FAIL; all other original gaps remain unchanged.
