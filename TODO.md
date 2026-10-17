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
  zone, theme toggle, voice button — and since 2026-10-17 the new provider picker: the preset list from
  `state.presets`, the key box (refused when empty), the address box, the *get a key ↗* link, and the
  one-sentence provider errors arriving as a toast instead of a stack of codes.
- **`re.disasm` quality.** It now says which engine answered (`meta.engine`: `rizin` | `objdump` |
  `none`), so a silent fallback is impossible — but the decoder itself is still a subset and objdump
  is missing on a stock Windows box. Ship a pure-JS x64 decoder worth its name, or bundle `rizin`
  with the `.exe`.
- **Kilo Gateway against the real endpoint.** The provider is wired and covered against the
  documented contract (local stand-in that validates the Bearer JWT, 401/402, `:free` ids, `/models`),
  but this sandbox has no egress to `ai-gateway.kilo.ai`, so nobody has seen a byte from Kilo itself.
  Needs one `majin doctor --full` on a machine with internet.

## P1

- **The provider card cannot edit a model list or `kind`.** Picking a preset is enough for the big
  providers, but a wrong or empty `models[]` still means the config file or a chat instruction. The
  card has a preset, a key and an address — the row's own model list is the missing piece.
- **`presets[].notes` is written but never shown.** Every preset has a one-line hint ("deepseek-flash
  = V4.1 Flash (cheap/fast)…", "200+ models, one key. Good for MOA references.") and the card ignores
  it, so the choice of model is a guess for someone who does not know the brands. One `kv` line under
  the picker would use text that already exists.
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
- **`readOnly` switch in the schedule card.** The flag works (`majin.schedule add … readOnly:true`,
  `schedule.readOnlyDefault`) and `POST /api/schedule` accepts it, but the panel's schedule form has
  no checkbox, so today it is a CLI/agent-only feature. Same commit as the dataset panel.
- **Cost truth.** `pricing` only has DeepSeek entries. Every other provider reports `$0` by design
  (we refuse to guess). Ship a small, curated price table + `majin config` guidance for the
  common ones, and surface "no price known" in the UI chip instead of silently showing $0. The Kilo
  and OpenRouter-style `/models` responses already carry per-model `pricing` — import it while
  discovering models (`majin provider models <name>`) instead of curating a table by hand.
- **Long-file RE.** `re.analyze` reads the whole file into memory (`tools.re.maxFileBytes` =
  256 MB). A 2 GB sample OOMs the process. Needs streaming/sampled reads for strings+entropy and a
  guard that says "too big, use re.scan windows".

## P2

- **Swedish in comments and test titles only.** Strings are gated now: `npm run i18n`
  (`scripts/i18n-check.mjs`) fails on any Swedish literal in `src/`, `scripts/`, `install.ps1`,
  `start-majin.cmd` — word list *and* `åäö` — with an allowlist for the lines that are Swedish on
  purpose (`routes.js` job keywords, `agent.js` `JOBS_SV`, `schedule.js` weekday abbreviations, the
  `glöm`/`ja`/`nej` and `godkänn/avslå` chat aliases) so Swedish still works as *input*.
  `test/i18n.test.js` asserts both directions, including that the input matchers are not
  "translated away". Comments in `binary/*.js`, `tools/*.js`, `agent.js`, `scripts/bench.mjs` are
  still Swedish: translate them while touching the file, never as a sweep.
- **`serveFlags` deserves a unit test.** The `majin start` → `_serve` flag forwarding bug (dropped
  `--host`, ignored `--no-channels`) was only findable by spawning a real server. Extract the
  flag→runtime-options mapping into a pure function and test it; keep one spawn test as a smoke test.
- **Cost history before the streaming fix is understated.** `openaiStream` returned raw
  `{prompt_tokens,completion_tokens}` where the tally reads `input`/`output`, so every streamed turn
  recorded 0 tokens. Fixed, but old `usage.json` months are wrong and cannot be rebuilt — a
  `majin usage --explain` note, or just let them age out at month boundaries.
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
