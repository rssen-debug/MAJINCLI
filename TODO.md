# TODO

Read me in order. Everything here is *not* done — verified against the code, not against memory.
Roadmap phases come from the owner's master brief (2026-10-18, "FINAL PRODUCTION BUILD" + the
autopilot/teamwork/dashboard additions).

## Hög prioritet

- ~~**Autopilot UI follow-up surface**~~ **SHIPPED 2026-10-18** (reply-to-this-agent rows,
  ⏸/▶ per card via `/api/tasks/action`, live "agents at work" deck — see CHANGELOG).
  Remaining: human click-through in the Windows round below; resumed runs now stream
  onto the card they were paused from, by design.
  *(källa: master brief §"TRUE PARALLEL AUTOPILOT")*
- **Browser-use — foundation done 2026-10-18.** CDP, six tools, slot pool, loop guard,
  evidence-everywhere, all deterministic parts tested (189/0). Remaining for the full claim:
  (1) `browser.upload` ✅, (2) smarttab (follow the spawned tab) ✅, (3) recovery cookbook ✅.
  Remaining: CI live step must print green across consecutive runs, then flip
  `continue-on-error` to a hard gate; checkbox/radio semantics beyond click (tristate ARIA),
  and a scrollIntoView-iframes note for big job portals.
  *(källa: master brief §2B — the live harness is the remaining proof)*
- ~~**Cost truth.**~~ **SLICE SHIPPED 2026-10-18**: pricing imports itself from the
  provider's own `/models` answer (gaps only, provenance in `pricingMeta`), `budget.mode
  'cap'` now actually stops paid calls before they cost (free = 0/0, mock, own server;
  unknown-price remote counts as paid, honestly), and `usage.summary()` carries
  `unpricedCount/unpricedRefs` so a silently-$0 month is impossible to miss. Remaining:
  slice-2's per-task cost chip in the UI, and eur/sek display.
  *(källa: master brief §2E)*
- **GENESIS OMEGA — universal capability-composition.** Phase 1 SHIPPED 2026-10-18:
  `cap/1` manifest per tool, deterministic `Registry.search`, the `tools.search`
  meta-tool and the system prompt pointing models at it. Next slices, in order of
  evidence value: (2) loop sends the relevant tool subset instead of all 103 — only
  after a bench.mjs before/after measurement justifies it (open question in
  DECISIONS), (3) mission compiler above the existing loop, (4) model capability
  profiler, (5) skill compiler. Do NOT build a parallel engine — extend this one.
  *(källa: master brief §GENESIS OMEGA directive)*
- **Windows/browser human round on top of the CI smoke.** CI now installs/runs/uninstalls on
  real Windows every build — and, as of the config-race fix (commit f6869bc, run 39134332080),
  it VERIFIES every build that a write from outside the process survives a restart. A
  human still has to click: provider picker, key box, first real model call, update chip →
  relaunch, Quit — and the new parallel task cards (send a second message mid-run, stop only that one). One run with notes, then this item dissolves.

## Medel

- ~~**Natural-language agent routing**~~ **SHIPPED 2026-10-18** (deterministic parse over live
  refs: stop/pause/resume/assist/status, zero model calls — see CHANGELOG). Remaining: compound
  sentences ("pausa hemsidan OCH hjälp jobbsökningen" in one line), LLM tiebreak behind the
  single-model rule (today ambiguity is an honest error sentence, never a guess).
- ~~**ETA engine on real telemetry**~~ **SHIPPED 2026-10-18 end-to-end**: per-tool ms from
  real `tool_result` events (wire bug fixed same day), intervals after 2 runs; task cards
  show elapsed + tool count + self-measured avg — no predicted totals, ever. Remaining:
  live `/api/tasks` deck for CHANNEL-started tasks (registry telemetry is already in the
  payload), and surfacing the global per-tool interval on cards when n is decent.
  *(källa: master brief §"LIVE VISUAL AGENT DASHBOARD & SMART ETA")*
- **Job-search agent — pipeline + submit SLICES SHIPPED 2026-10-18** (state machine,
  dedupe = pipeline file, deterministic CV match, Platsbanken live-verified,
  `jobs.prepare` form-fill with exact preview + validity flags, `jobs.send`
  destructive-gated with mandatory proof — no confirmation words, no
  "submitted"), all CI-oBserved on the Windows live gate (run 39 126 567 525).
  94 tools. Remaining:
  pipeline status cards in the UI, Seek/AU adapters, the email-application path
  (currently refused honestly), the scheduled autonomous round on schedule.js,
  and checkbox/privacy-consent field roles in the form classifier.
  *(källa: master brief §"VIKTIGT TILLÄGG" — 10 requirements; ships inside the
  Windows installer by construction)*
- **Imagination Engine slices 2–4** (cost chip per task, Living Canvas, Preview/Working/Verified
  labels) and slices 5–8 longer scope — gates: cheap-model E2E, keyboard pass, CPU/mem budget,
  all prior tests green. Spec `docs/IMAGINATION.md`.
- The provider card cannot edit a model list/`kind`; show `presets[].notes` under the picker;
  dataset panel + `readOnly` checkbox in the UI; ratings from chat channels; redaction is
  regex-based not semantic; channel end-to-end with a throwaway bot; long-file RE (streaming);
  `serveFlags` unit test; `--json` everywhere in the CLI; session rename/export UI;
  `majin doctor --full` sandbox-escape self-check; scheduled-job isolation (per-job timeout);
  `parseIntent` table-ization before it grows unreviewable; old understated cost history note.

## Låg

- Voice: barge-in, wake-word false-positive tuning, TTS voice picking from `ui.voice.ttsVoice`.
- `screen.capture` → vision model loop is one-shot; needs crop/zoom follow-up.
- Skill editor in the panel.
- Packaging: `.msi`/winget manifest if we ever ship beyond a single exe.
- Cost history before the streaming fix is understated (let it age out, or a `--explain` note).

## Idéer (med källa)

- **Living Missions / Future Engine** — one persistent goal ("flytta till Australien") holding
  many cooperating agents, alternative paths compared before acting, decision points requiring
  the user, proof-based completion. Build only when browser-use + parallel agents + verification
  are done. *(källa: master brief §"MAJIN Future Engine", 7777-blocket)*
- **Zero-key read backends** (Jina-reader-style url→text, RSS) as tools; YouTube captions via the
  yt-dlp pattern. *(källa: Agent-Reach, loxholm — patterns, not imports)*
- **Multi-machine config sync** — only as an explicit, encrypted, user-pulled file, never a
  background service. *(källa: internal review)*
- **`majin dataset import`** (move captured data to another machine) — on hold until the format
  and trust question settles. *(källa: internal review)*
- **Deliberately not planned:** silent telemetry or key mirroring; "improvement" uploads without
  stored opt-in (dataset capture has *no upload code path at all*); rewriting MAJIN's own source
  at runtime (self-config edits config only, with backup + diff); anything needing Windows
  Defender/firewall/service mutation. *(källa: repo principle, see DECISIONS.md)*
