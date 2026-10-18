# TODO

Read me in order. Everything here is *not* done — verified against the code, not against memory.
Roadmap phases come from the owner's master brief (2026-10-18, "FINAL PRODUCTION BUILD" + the
autopilot/teamwork/dashboard additions).

## Hög prioritet

- **Autopilot UI — the S.busy wall comes down.** The registry + resource locks + task-aware
  `/api/chat` shipped this round (backend, tested), but the window still blocks a new message
  while a turn runs (`src/ui/app.js` `S.busy`). Replace it with task cards: every independent
  message starts a task (send `autopilot: true`, consume the `event: task`), follow-ups carry the
  task id, each card shows real status from `/api/tasks` (running / waiting / done / error /
  stopped), with pause (later), stop (exists: `POST /api/chat/stop {task}`) and open-details.
  *(källa: master brief §"TRUE PARALLEL AUTOPILOT" — definition of done is the three-messages-
  in-a-row scenario)*
- **Browser-use robustness.** Playwright path already exists; it is NOT verified for real work:
  stuck loops, retries, recovery, per-agent isolated browser contexts (locks for browser
  instances the way files are locked now), checkbox/form/upload handling, screenshot evidence
  before "done". *(källa: master brief §2B + §"the honest grid" — "browser-use: inte
  färdigverifierat")*
- **Cost truth.** `pricing` only has DeepSeek entries — every other provider reports $0 by
  design. Kilo/OpenRouter `/models` answers carry per-model pricing: import it during model
  discovery instead of curating by hand, then slice-2's cost chip + the real budget cap
  (stop new paid calls when the cap is hit). *(källa: master brief §2E)*
- **Windows/browser human round on top of the CI smoke.** CI now installs/runs/uninstalls on
  real Windows every build (job "the installer must install, run, survive a restart"), but a
  human still has to click: provider picker, key box, first real model call, update chip →
  relaunch, Quit. One run with notes, then this item dissolves.

## Medel

- **Natural-language agent routing** ("agent 2, hjälp agent 1", "pausa hemsidan och hjälp
  jobbsökningen"): deterministic command parse over live task ids first (no LLM for routing),
  LLM tiebreak only behind the single-model rule; context handoff = sibling summary from the
  registry, restart-less reassignment. *(källa: master brief §"DYNAMIC AGENT TEAMWORK" — 13
  requirements)*
- **ETA engine on real telemetry**: per-tool/per-step timings recorded in the registry, intervals
  only ("4–8 min"), "hard to estimate" when data is thin — never invented percentages.
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
