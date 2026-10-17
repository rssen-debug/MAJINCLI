# TODO

Priority order. `P0` = do next, `P1` = important, `P2` = worth doing, `P3` = nice to have.
Everything here is *not* done — verified against the code, not against memory.

## P0

- **Windows host verification.** `install.ps1`, the `.lnk`/icon, the Task Scheduler entry and
  `majin-win-x64.exe` have never been run on a Windows machine (the sandbox has no PowerShell, no
  wine, no mingw). Needs one real run on Windows, then delete this line.
- **Browser verification of the UI.** `src/ui/{index.html,app.js,panels.js}` is validated by
  `node --check`, the HTTP suite and status/type assertions — never rendered. Needs a human (or a
  headless browser) to click through: composer + SSE stream, panel edits, approval prompt, RE drop
  zone, theme toggle, voice button.
- **`re.disasm` quality.** objdump is available on Linux but not on a stock Windows box, and the
  built-in fallback decoder is a subset. Either ship a pure-JS decoder worth its name or make
  `re.disasm` state plainly which engine answered.

## P1

- **Dataset panel in the UI.** Recording is done (off by default, redacted, `majin dataset` +
  `majin.dataset` + `GET/POST /api/dataset`), but the window has no block for it: a capture switch,
  `N records · file`, export and purge buttons. Do it together with the browser verification above so
  the first claim about the panel is a rendered one.
- **Ratings from the chat channels.** A verdict-only message (`good`, `👎`, `fel`) labels the newest
  record; Telegram/WhatsApp have no inline buttons, so a stray "thanks" in a chat is a label. Needs
  per-channel handling (buttons, or ignoring verdicts from chats that never asked).
- **Redaction is regex-based, not semantic.** It catches keys, tokens, JWTs, cards, home paths and
  usernames; it will not catch "my password is swordfish" or a path under `D:\work`. Needs a
  redaction corpus from real-ish Windows machines (usernames with dots, OneDrive paths, `%USERPROFILE%`
  variants, env-var names) and a rule that a *file body* a tool read is never copied into a record.
- **Channel end-to-end.** Telegram (`getUpdates` long polling) and WhatsApp (Baileys) are wired and
  unit-covered for config/allow-lists; `whatsapp` now backs off and gives up instead of reconnecting
  forever, but no real bot token / QR pairing has been exercised from here (no egress). Needs a live
  run with a throwaway bot.
- **Cost truth.** `pricing` only has DeepSeek entries. Every other provider reports `$0` by design
  (we refuse to guess). Ship a small, curated price table + `majin config` guidance for the
  common ones, and surface "no price known" in the UI chip instead of silently showing $0.
- **Long-file RE.** `re.analyze` reads the whole file into memory (`tools.re.maxFileBytes` =
  256 MB). A 2 GB sample OOMs the process. Needs streaming/sampled reads for strings+entropy and a
  guard that says "too big, use re.scan windows".

## P2

- **Swedish in internals only.** Comments and a few `bus` debug labels (`src/core/binary/*.js`,
  `tools/*.js`, `core/agent.js`, `scripts/bench.mjs`) are still Swedish, and some test titles.
  Every user- and model-visible string is English now; the Swedish that remains on purpose lives in
  the *input* matchers (`routes.js` job keywords, `agent.js` `JOBS_SV`, `schedule.js` weekday
  abbreviations) so a Swedish sentence still routes and still parses. Translate comments only when
  touching the file for another reason.
- **`serveFlags` deserves a unit test.** The `majin start` → `_serve` flag forwarding bug (dropped
  `--host`, ignored `--no-channels`) was only findable by spawning a real server. Extract the
  flag→runtime-options mapping into a pure function and test it; keep one spawn test as a smoke test.
- **`--json` for every CLI command** (`majin status --json`, `config get --json` is already JSON) so
  the CLI composes in scripts, and `majin dataset --json` for the same reason.
- **Session management UI.** `/api/sessions` + `/api/session/clear` exist; the rail lists sessions but
  cannot rename/export one.
- **`majin doctor --full`** should also verify the *sandbox escape* assumptions it claims: that
  `fs.delete` refuses a root, that `neverOn` blocks, that the token is required from a remote host.
  Those are in the test suite but not in doctor, so an installed exe cannot self-check them.
- **Scheduled-job isolation.** Jobs share `tasks.concurrency`; a runaway job can starve the queue.
  Needs a per-job timeout + error backoff (currently a failing cron fires every tick).
- **`parseIntent` is a regex pile with tested Swedish/English examples.** It works and is covered
  (selfconfig + dataset cases), but two of its behaviours just bit: a mentioned key used to be
  saved, and "do not save this" used to flip capture off. Before adding more rules, extract a table
  of (pattern → patch) with one test per row, or it will keep growing unreviewable.

## P3

- Voice: barge-in, wake-word false-positive tuning, TTS voice picking from `ui.voice.ttsVoice`.
- `screen.capture` → vision model loop is one-shot; needs a crop/zoom follow-up when the model asks.
- Skill editor in the panel (today skills are only harvested automatically; `majin.skill` can write).
- Packaging: a `.msi`/winget manifest if we ever ship beyond a single exe.
- Multi-machine: config sync is deliberately absent; if wanted, do it as an explicit, encrypted,
  user-pulled file — not a background service.
- `majin dataset import` (move a captured set to another machine) — deliberately absent until the
  format and trust question is settled.

## Deliberately not planned

- Silent telemetry, key mirroring to any server, or "improvement" uploads without a stored opt-in.
  Dataset capture has **no upload code path at all**: `dataset.upload` is rejected by config
  validation, and sharing means exporting the JSONL yourself.
- Rewriting MAJIN's own source at runtime (self-config edits *config*, with backup + diff, only).
- Anything that needs Windows Defender/firewall/service mutation.
