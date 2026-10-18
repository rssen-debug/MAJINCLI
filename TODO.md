# TODO

Read me in order. Everything here is *not* done — verified against the code, not against memory.
Roadmap phases come from the owner's master brief (2026-10-18, "FINAL PRODUCTION BUILD" + the
autopilot/teamwork/dashboard additions).

## Hög prioritet

- **Autopilot UI: done 2026-10-18 except the follow-up surface** — cards live in chat
  (status/stop/stream pinned by contract test; human click-through still in the round below).
  Remaining: click a card → "reply to this task" (routing `body.task` exists server-side),
  pause/resume (registry states exist; the loop does not), and a live `/api/tasks` deck for
  channel-started tasks. Natural-language routing stays in Medel until the parse is designed.
  *(källa: master brief §"TRUE PARALLEL AUTOPILOT")*
- **Browser-use — foundation done 2026-10-18.** CDP, six tools, slot pool, loop guard,
  evidence-everywhere, all deterministic parts tested (189/0). Remaining for the full claim:
  (1) `browser.upload` ✅, (2) smarttab (follow the spawned tab) ✅, (3) recovery cookbook ✅.
  Remaining: CI live step must print green across consecutive runs, then flip
  `continue-on-error` to a hard gate; checkbox/radio semantics beyond click (tristate ARIA),
  and a scrollIntoView-iframes note for big job portals.
  *(källa: master brief §2B — the live harness is the remaining proof)*
- **Cost truth.** `pricing` only has DeepSeek entries — every other provider reports $0 by
  design. Kilo/OpenRouter `/models` answers carry per-model pricing: import it during model
  discovery instead of curating by hand, then slice-2's cost chip + the real budget cap
  (stop new paid calls when the cap is hit). *(källa: master brief §2E)*
- **Windows/browser human round on top of the CI smoke.** CI now installs/runs/uninstalls on
  real Windows every build (job "the installer must install, run, survive a restart"), but a
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
- **Job-search agent** as tools + skills on top of the verified browser layer: search → match
  against CV → dedupe memory → status cards (found/matched/started/waiting/submitted/failed) →
  approval before every submission → proof of each submission. Research assets: Agent-Reach,
  Playwright MCP, MadsLorentzen/ai-job-search (patterns only, no second framework).
  *(källa: master brief §"VIKTIGT TILLÄGG" — 10 requirements, must ship inside the Windows
  installer, no standalone Python script)*
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
