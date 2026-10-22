# MAJIN V2 — competitor capability audit (2026-10-22)

**Scope:** source-backed research and MAJIN's checked-in evidence, not a claim of live feature parity. Never equate a method existing with a completed real-world task.

## Source comparison

| Product | Documented advantage | MAJIN current evidence | Priority / adoption |
| --- | --- | --- | --- |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Automatic procedural-skill learning and improvement, FTS5 past-session retrieval, messaging gateway, natural-language cron, multiple sandbox backends, isolated subagents | MAJIN has skills/outcome routing, memory, jobs, teams, and execution backends (see `docs/MAJIN_100_STATUS.md`). Cross-session retrieval quality and learned skill replay on actual user tasks are not established at Hermes parity. | **P0:** measurable recall/replay benchmark, with safe approval and task-success evidence. Reuse ideas, not an entire second runtime. |
| [OpenClaw](https://docs.openclaw.ai/concepts/features) | Broad mobile nodes and channel/plugin ecosystem, device pairing, media, workflow pipelines, heartbeat automation | MAJIN has channels and voice prototypes; `docs/MAJIN_100_STATUS.md` labels inbound channel expansion offline-verified but live-pending. | **P0:** live channel and mobile/desktop journeys; **P1:** opt-in adapter architecture, permissions per channel. |
| [Grok Bot](https://docs.x.ai/grok-bot/overview) | Persistent cloud computer, parallel named bots, shared authenticated browser/files, demonstrations saved as skills, scheduled work while device is offline | MAJIN has local Windows execution, swarm, memory, and mission recovery; a dependable hosted persistent computer with real login/session recovery is not proven. | **P0:** durable job execution and human approval handoff; **P1:** opt-in isolated cloud worker and demonstrated-workflow replay. |

## Immediate implementation in this branch

- **Visual:** keep MAJIN's live status visible while connecting, thinking and working, with a quiet pink dot; animate only when motion preference allows it.
- **Tests:** guard against hiding working status and require reduced-motion handling.
- No third-party agent code vendored, no model credentials added, no automatic high-risk permissions, no claim of autonomous parity.

## Required evidence before a 100% claim

1. Real Windows computer-use acceptance, with screenshots and verified artifacts.
2. End-to-end login, browser interaction, approvals, interruption, resume and update/rollback.
3. A multi-hour unattended job completing and reporting accurately; failure injection and recovery.
4. Live voice and channel delivery tests on supported devices.
5. Comparative tasks with the same inputs, completion criteria, cost, latency, and failure rates across MAJIN, Hermes, OpenClaw and Grok Bot.

**Scoring:** `docs/REAL_WORLD_READINESS.md` previously recorded **75/110 ≈ 68/100** in a narrower, dated assessment; `docs/MAJIN_100_STATUS.md` records **99/100** for its *specific W1–W14 acceptance rubric*. Neither number is proof that MAJIN V2 matches all three products. A fresh whole-product acceptance score is pending.
