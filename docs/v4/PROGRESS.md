# MAJIN V4 — verified progress

**As of:** 2026-10-22 (Europe/Stockholm)
**Branch:** `v4/main` · **Base:** V3 `df678b2`
**Release status:** **NOT READY** — private vertical slice works, no verified public URL.
**Score source of truth:** `npm run v4:progress` (recomputed from `ACCEPTANCE_MATRIX.json`, never hand-written)

## Score

- **Verified:** **67.5/100** points (**67.5%**)
- **Criteria:** 75 → 52 VERIFIED · 5 PARTIAL · 15 NOT_STARTED · 3 BLOCKED

| Area | Earned | Weight | What is actually proven |
|---|---:|---:|---|
| BASELINE | 4 | 4 | refs recorded, protected branches untouched, no secrets, matrix validated by code |
| MOBILE | 9.5 | 12 | manifest + icons, safe areas, responsive, reduced motion, 42px targets, SW shell-only, model picker |
| SECURITY | 12.5 | 14 | pairing, sessions, revocation, CSRF, origin/host, rate limits, CSP, traversal, no keys to client |
| CONVERSATION | 7.5 | 9 | streaming, persistence, idempotent retry, cancellation, scoping, deletion, honest errors |
| GOALS | 10 | 14 | V2 state machine, SHA-256 verification, receipts, crash→BLOCKED, no completion without evidence |
| MODELS | 11 | 14 | V1 config reuse, discovery without secrets, id scoping, demo degradation |
| VOICE | 5 | 9 | honest capability model, language, error copy, auto-send rules, speech text |
| PLATFORM | 8 | 12 | versioned kernel, manifest validation, rollback, opt-in + allowlist + flags |
| HOST | 0 | 12 | nothing verified — no Windows host and no tunnel in this environment |

## What works right now (evidence-backed)

1. A phone-sized browser can pair with a code, receive a session and hold a conversation.
2. A real turn streams over SSE, executes typed tools and verifies file writes on disk (SHA-256).
3. Conversation history, goals and receipts persist to disk and survive a restart.
4. A repeated `requestId` is replayed instead of executing twice (safe reconnects).
5. Cancellation aborts the active turn and records `CANCELLED`.
6. `GET /api/models` lists the models from the existing Windows MAJIN config, with no key material.
7. Model choice is scoped to one conversation and validated server-side.
8. Without a configured provider the app runs a labelled demo brain — it cannot pretend to be an LLM.
9. PWA shell is installable (manifest + 192/512/maskable icons) and never caches API data.
10. Plugin kernel validates manifests, enforces declared permissions and rolls back failed activations.

## Open blockers

- **H3/H4 (8 points):** no private HTTPS URL and no physical iPhone/Android run. Needs the owner to
  run the tunnel on their Windows PC (`docs/v4/DEPLOYMENT.md`) — credentials/DNS are the owner's.
- **A7 (4 points):** real inference through a configured provider is blocked here: no provider key
  and no outbound network to a model endpoint in this sandbox.
- **H1/H2/H5/H6:** Windows-specific automation (logon task, desktop session limits, restart
  persistence on the real box) is written as scripts but unexecuted on Windows.
- **Voice V6/V7:** no measured TTS latency, no barge-in measurement, no server-side STT/TTS wiring.

## Honest limitations of the demo brain

The demo brain understands a narrow set of file intents (write / list) and otherwise explains that
no model is connected. It is a transport-and-execution harness for real model wiring, not an
assistant. Any progress point that depends on model quality is not claimed.

## Next engineering objective

Wire the tunnel and a real provider on the Windows host, then run the acceptance scenario in
`NEXT_ACTIONS.md` #1 and move HOST points from NOT_STARTED to VERIFIED with captured evidence.
