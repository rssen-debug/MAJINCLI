# Final feature parity audit — MAJIN V4

Audit date: 2026-10-23. Target: `v4/main`, integration PR [#401](https://github.com/rssen-debug/MAJINCLI/pull/401).

**Current Ghost delta — NOT READY:** [Ghost acceptance](GHOST_ACCEPTANCE_20261023.md)
records verified backup/restore, live provider, crash recovery, shared history,
CLI migration and owner-confirmed mobile chat repair. The owner reports Safari
microphone failure; the new recording/local STT path is not physically accepted.
Production signing/native installation, login startup, updates and the functional
gaps below remain requirements. Initial krist-only paragraphs are historical.
V2 permission hardening adds one inventory component; the STT path reuses that
privacy helper (now 22/52 imported). It does not wire V2 cryptographic audit into V4.

Source snapshots actually fetched:

| Version | Branch | Commit |
|---|---|---|
| V1 | main | e84b716e79ac4fc3cb443280e56d3f12553c8fc2 |
| V2 | v2/main | 1ef253fb1f44406c262a290e170902403f68cceb |
| V3 | v3/main | df678b21dfb784233da8cea25bdc54722a61236a |
| V4 base | v4/main | 588dcbb52bf6672f20dc901155181b595bb8156f |

## Scope and evidence rules

This audit ran on Windows as `krist`. The owner confirmed that Ghost is the eventual production target and authorized testing on krist. Neither the Ghost installation nor its private Tailscale endpoint was reachable here. Most tests used isolated MAJIN_HOME directories and scripted/demo inference. After explicit owner authorization, live tests read the existing krist provider configuration without displaying or changing credential contents: OpenCode/glm-5.3 streaming, verified file operations and a dependent agent graph passed (8 model calls, peak concurrency 2). Test history remained isolated. This is not Ghost acceptance.

The generated [component inventory](CAPABILITY_INVENTORY.md) records every V1 tool module and V2/V3 component, including excluded modules. It currently identifies 141 V1 tools, 111 adapted tool definitions, 30 excluded tools, and 21 of 51 V2 components imported. These counts are implementation inventory, **not proof of functional parity**. Registered capabilities still depend on host availability and explicit owner grants.

The V2 source under src/v2 matches the fetched branch except its doctor compatibility adjustment and the STT command adapter, which now reuses V2's existing shell-free quoted argv executor. V3 source matches its fetched branch. Current V1 browser grounding, action receipts, semantic/shadow DOM handling, verification, recovery and supporting UI/loop changes were brought into V4's existing V1 adapters. V4's filesystem grant guards were retained.

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
| Provider routing | V1 provider transports + V4 config/model catalog | Preserved active-provider routing, header and streaming support | Scripted provider contracts plus authorized live OpenCode/glm-5.3 streaming, verified file tools and concurrent dependency graph on krist | Server-only credentials | Repeat with the existing configuration on Ghost; target access is unavailable |
| Voice recognition/TTS | V1/V2 voice engines; V4 voice API and browser speech | PARTIAL: tap-to-talk and synthesis exist; unsupported recognition is reported | voice-server and UI tests; no physical microphone test | Browser-dependent | Wire a configured production STT fallback where browser recognition is unavailable, then test iPhone/Android/Windows audio |
| Voice interruption | V4 cancelSpeech and task interruption | PARTIAL: explicit speech cancellation; automatic barge-in is not implemented | Cancellation contracts only | Browser support varies | Implement and measure real barge-in/noise handling; do not claim it exists |
| Text/code/CSV | V4 uploads/extract and V1 filesystem | Upload, extraction, editing and download; equivalent for text workflows | uploads/extract/file-access tests | Shared attachments/downloads | Large-file and physical-device checks |
| PDF/DOCX/XLSX | V4 extract.js | Extracts DOCX/XLSX containers and supported PDF text streams; partial PDF encodings are reported | extract.test.js | Upload, extraction, output download | Scanned PDF OCR is unsupported; select/configure an OCR provider rather than treating upload as understanding |
| Previews | V4 uploads and UI | Images/PDF/HTML and attachment cards; document text extraction | uploads/client-dom tests and browser screenshots | Same UI | Rich native DOCX/XLSX previews are PARTIAL |
| Windows desktop app | V1 Edge/Chrome --app launcher | Replaced by actual Electron BrowserWindow hosting existing V4 UI; not a browser shortcut | Actual alpha.2 per-user upgrade/data preservation, installed executable pairing/chat/file and bundled-host cold start on krist | N/A | Sign installer; physical voice, DPI/multimonitor and Ghost acceptance |
| Mobile PWA | V4 manifest/service worker/UI | Preserved shared UI; fixed hidden modal intercepting clicks and bumped shell cache version | Five real Chromium viewport flows, screenshots | Yes | Real Safari/Android and 5G tests remain BLOCKED |
| Notifications/background workflows | V1 sys.notify/flows/heartbeat | PARTIAL: notify/flows adapted; supervisor is not a replacement for proactive event digests | Existing tool contracts | Server events/progress | Port V1 heartbeat/event subscriptions to V4 lifecycle; add mobile push where authorized |
| Auto-start and crash recovery | V1 Scheduled Task settings; V4 supervisor | Preserves battery/unlimited lifetime settings; hidden supervisor startup, duplicate task policy; fixes hung-process replacement | Actual supervisor process tests; PowerShell installer contracts | Host recovery benefits both clients | Actual login/crash acceptance on Ghost remains untested |
| Signed host updates | V4 updater/supervisor | Existing Ed25519 manifest/hash verification, journal, health and rollback preserved | updater/release-flow/update-auto process tests using disposable signing keys | PWA served from updated host | Pin the owner's trusted production identity/channel; test real release on Ghost |
| Native app updates | New Windows shell | NOT EQUIVALENT to the host updater: host updates do not replace a running Electron executable | Installer build only | N/A | Add verified native-shell update activation/rollback with the approved production signing identity |
| Backup/rollback | V4 backup/updater | Existing verified backup and rollback retained | backup/updater tests, no production restore performed | Server-owned data | Back up Ghost data/config/local changes before installation; preserve trust/key/session material separately |
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
