# Changelog

Notable changes on `arena/e223e8b9-slurps` (PR #1). Newest first. Verified in the Linux sandbox
unless stated otherwise; nothing here claims a Windows or browser run.

## Unreleased — 2026-10-17 (late)

Run-driven work: the agent was started for real (temp `MAJIN_HOME`s, demo provider,
`server.trustLocal:false`) and driven through `/api/state`, `/api/chat`, `/api/tools`, `/api/logs`,
`/api/selftest`, `/api/dataset`. That is where every bug below came from.

### Added
- **Dataset capture** (`src/core/dataset.js`) — consent-first, local-only trajectory recording, the
  only thing MAJIN keeps about *how it worked*. One JSONL line per turn (instruction, plan, tool
  sequence with arguments, answer, usage, error, rating). `dataset.capture` is **false** by default;
  redaction runs before every write and has no switch; a turn saying "do not save this" is skipped
  before the file is touched; `dataset.include` can drop answer/toolArgs/plan; `keepDays` (90) trims
  on start-up; `majin dataset on|off|list|export [--clean]|purge`, tool `majin.dataset`
  (status|on|off|stats|list|export|purge|rate) and `GET|POST /api/dataset`. **There is no upload
  code path and `dataset.upload` is rejected by config validation** — sharing means carrying the
  exported file yourself. Natural language drives it too: "learn from my runs", "record my turns as
  training data", "stop recording my runs", "do not capture my sessions". A verdict-only turn
  (`good`, `wrong`, `👍`, `👎`, `tack`, `fel`) labels the newest record and spends no tokens.
- `docs/DATA.md` — record shape, redaction list, per-turn opt-out, retention, export usage;
  `docs/CONFIG.md` gained the dataset section and a corrected `channels` block (the old one
  described a `webhook` shape that no longer matches `DEFAULTS`).
- `test/dataset.test.js` — 10 cases: off by default, redaction (keys/bearer/JWT/card/home/username/
  email), record shape (result *sizes*, never bodies), opt-out leaves no file, rating + export +
  purge round-trip, no upload method and a rejected `dataset.upload` key, `keepDays` trim, natural
  language both directions, and a real agent turn captured end to end.

### Fixed
- `majin start` forwarded only `--json/--port/--no-channels` to `_serve`: `--host` was silently
  dropped (so a requested `127.0.0.1` bound `0.0.0.0` instead) and `--no-browser` did nothing. It
  now forwards the flags you actually typed, and `serve()` honours `--no-channels`
  (`const wantChannels = !(flags.noChannels || flags.channels === false)`), `--host` and
  `--no-browser`; the start banner says `channels off (--no-channels)` instead of lying.
- WhatsApp/Baileys retried every 3 s forever on a fresh install (log spam, CPU, pointless WebSockets
  to WhatsApp). Now exponential backoff (3 s → 6 → 12 → 24 → 48 → capped at 300 s) and it gives up
  into state `stopped` after `channels.whatsapp.maxRetries` (new, default 6) attempts when nothing
  ever paired. Verified from real timestamps in a live run: 54.7 → 57.8 → 13:39:03.9 → 15.9 → 39.9.
- `/api/selftest` painted a fresh install red: unconfigured channels counted as failures, and the
  numeric `busy` entry of `channels.status()` was printed as "kanal busy". Skipped checks are now
  `ℹ` rows that do not fail the run, non-object entries are ignored, and it checks two things worth
  knowing (`yara rules`, `remote bind` + token presence, with an explicit warning when
  `server.token` is unset).
- **A mentioned API key is no longer saved to the config.** `parseIntent` treated any `sk-…` in a
  message as "here is my key" — a turn like `read notes.txt key sk-…` rewrote
  `providers.<default>.apiKey`. A key now has to sit next to an intent word (`key is`, `nyckel:`,
  `set/use/here/save` within 40 chars), and a message that is *only* a key still configures the
  default provider.
- "do not save this about my salary" flipped `dataset.capture` off globally; the on/off rules now
  require the object to actually be runs/turns/sessions/dataset, while the per-turn opt-out stays
  word-level.
- `providers.<name>.preset` reported `okänt preset: demo` with no way out — the error now lists the
  valid names.
- `loop.js` never recorded tool **arguments** in `toolLog`, which made a captured trajectory nearly
  useless as training data (`args: {}`). They are stored now (redacted, capped at 400 chars).
- Swedish purge, second pass, this time against live output rather than `desc:` fields: the mock
  provider answer, the aggregator/evidence headers, tool result copy in `fs.*`/`net.*`/`sys.*`/
  `re.*`/`majin.*`, guard approval texts, channel messages (`/help`, pairing, blocked), provider
  preset taglines, subagent + vision + memory prompts, `RE` engine notes in `binary/*`
  (containers/elf/pe/reader/scan/sigs/external), `/api/*` error strings, the UI error chip, the
  start banner, and `majin start`'s self-config notes. **All user- and model-visible strings in
  `src/` are English now**; Swedish survives only in code comments and, on purpose, in the input
  matchers (`routes.js` job keywords, `agent.js` `JOBS_SV`, `schedule.js` weekday abbreviations) so a
  Swedish sentence still routes and still parses.
- Two mangled strings from an earlier replace are gone (`MOA: hard jobsb`, `majin start —window`).

### Fixed (third pass — Swedish without diacritics)
The first two sweeps keyed on `åäö`, so plain Swedish words survived. Caught by reading live
output: `majin re` printed "hel rapport", `majin send` "svar kunde inte tolkas", the self-config
answer began "Klart.", the attachment header said "bilaga/sökvägar", the compaction prompt
("Sammanfatta konversationen…"), the tool-error prompt (`FEL [..] HJÄLP:`), `majin.channel`
("KANALER"), `binary/pe` ("Saknar PE-signatur"), `binary/sigs` ("stor overlay", "varnar"),
`binary/external` hints ("eller installera…"), every `why:`/`what:` note in the RE tables, plus
`install.ps1` ("PATH: redan installerad") and `start-majin.cmd`. All English now; the only Swedish
left in `src/` is comments and the deliberate input matchers (routes/router job keywords, `JOBS_SV`,
schedule weekday abbreviations, the `glöm`/`ja`/`nej` aliases) so Swedish still works as input.
`re.disasm` also returns `meta.engine` (`rizin` | `objdump` | `none`) so a caller can tell which
engine answered instead of trusting the name of the tool.

### Verified
- `node --test test/*.test.js` → **70/70 pass** (was 60; +10 dataset cases).
- `npm run check` → `62/62 files parse cleanly`; `node --check` on every file touched this turn.
- `npm run bench` → `7/7 runs green · p50 56 ms · p95 4536 ms · VERDICT: pass`.
- Live server on 127.0.0.1:8795: `--no-channels` really off (`/api/state` channels `off/off`),
  `--no-browser` opened nothing, `ss -ltn` shows only the loopback listener, `POST /api/selftest`
  returns English rows with `ℹ` for unconfigured channels, `GET/POST /api/dataset` stats+export.
- Redaction proven on a live file: a turn containing `sk-LIVESECRET1234567890AB` produced
  `instruction: "read notes.txt key <API_KEY>"`, `grep -c sk-LIVESECRET` → 0 in
  `trajectories.jsonl` and in the export, and (after the `parseIntent` fix) 0 in `config.json`.

### Not verified (still)
- Windows: `install.ps1`, the exe bytes, `.lnk`/task registration — no `pwsh`, `wine` or mingw here.
- `src/ui/*` in a real browser (the dataset export/list buttons are UI-visible but the panel itself
  has only been read, not rendered).
- Live Telegram/WhatsApp pairing against the real services.

## Unreleased — 2026-10-17

### Added
- `TODO.md`, `CHANGELOG.md`.
- Docs, all English, written against the code: `README.md` (there was none), `docs/CONFIG.md`,
  `docs/REVERSE.md`, `docs/WINDOWS.md`, `docs/EXE.md`, `docs/BENCHMARKS.md`.
- `scripts/bench.mjs` — deterministic scenario harness on the mock provider (7 scenarios:
  fs.write, read+summarise, re.analyze, shell.run, multi-step, self-config, guard-approval),
  `--json` verdict, `--turns=N` percentiles, exit code for CI. `npm run bench`, `npm run bench:json`.
- `test/re.test.js` (8 cases), `test/agent.test.js` (9), `test/server.test.js` (8, real child
  process on an OS-chosen free port). Suite total: **60 tests, all passing**.
- `re.hash` now returns `meta.hashes` (`md5`/`sha1`/`sha256`/`imphash`, size, file) so a hash is
  reusable instead of only displayable.
- Server: SPA deep links (`/panel`) fall back to `index.html`; SSE sends `retry: 15000`;
  `/api/chat` accepts `input` | `prompt` | `text` | `content` | `messages[]` and `?stream=false`.
- Auth: `server.allowRemote` is now enforced — the trusted-host rule only applies to packets that
  actually arrive from loopback, so a forged `Host: localhost` from a remote peer is refused.
  `authOk` exported for unit testing.
- CLI: `npm run check` output in English. (The trajectory recorder landed later as `dataset.*` +
  `majin dataset` — see the section below; there was never a `memory.dataset` key.)
- Exe pipeline: `scripts/build-exe.mjs` (esbuild → `dist/majin.cjs` → `@yao-pkg/pkg`),
  `npm run exe|exe:all|exe:bundle`, SEA-safe path resolution (`SELF_DIR`, `pkgRules`, snapshot-aware
  UI lookup, respawn via `process.execPath` under pkg), `.github/workflows/build-exe.yml`
  (windows-latest build + artifact smoke test `exe version` / `exe doctor`, release on `v*`).
- Icon: voted Majin mark in `assets/` (512/256/transparent/`.ico` 16–256 px), served as the UI
  logo + favicon, used by the Start Menu/Desktop shortcuts.

### Fixed
- **PE parsing was broken for every real `.exe`.** The MZ magic check read `DataView.getUint16(0)`
  (big-endian by default) against `0x5a4d`, so `parsePe` threw on any genuine PE. (found by
  `test/re.test.js`)
- `majin serve --port 8931` (space form) parsed the flag as boolean → `Number(true)` → port 1 →
  `EACCES`. `parseFlags` now consumes an argument for value flags; boolean flags are unchanged.
- Loopback trust never matched `127.0.0.1` (regex anchored on a bare `127.` prefix), so
  `http://127.0.0.1:8787` rendered the "key required" page instead of the UI.
- `MAJIN_TOKEN` / `MAJIN_PORT` were documented but ignored by the config loader.
- Relative data dirs (`memory.dir: "memory"`, and the previously dead `skills.dir`) resolved
  against `process.cwd()`: MAJIN wrote its memory into whatever folder it started in — the repo in
  dev, an unwritable `Program Files` when installed. Now resolved under the MAJIN home;
  `memory/`/`skills/` are no longer tracked in git.
- `agent.plan` called the runtime's 3-arg `setPlan(session, plan, note)` with 2 args, so plans never
  reached the UI and `merge` had nothing to merge into; `registry.exec` now bridges
  `setPlan`/`getPlan` per session, and `agent.plan` auto-ids no longer collide on merge.
- `guard.js` referenced an undefined `spawnApproval` (every non-`off` mode threw for write/exec
  tools); approval-wait timer was `unref`'d so a headless run hung forever.
- `fs.delete`/`fs.move` with an empty path defaulted to `cwd`/`.` — a deletion hazard. Path defaults
  are workspace-rooted and workspace/`~`/drive roots are protected (`error.code: 'protected'`).
- `isBinaryMagic` never matched; `agreement([])` returned 1 (fake consensus); MOA answer regex
  missed `SVAR|ANSWER`; `fs.grep` on a directory raised EISDIR; `fs.tar` included its own archive;
  `globToRe` mis-escaped `*`/`/`; `shell.js` lost cwd on spawn errors.
- PE/ELF/yara/strings: `.exe` + a quoted `"fil"` lost the `tasks` route until binary evidence was
  reweighted; explicit `provider/model` tokens are now parsed before fuzzy matching, so
  `openrouter/deepseek/...` is no longer mangled.
- i18n: user-facing surfaces are English — the whole UI, all 75 tool `desc`/`params`, config
  defaults and validation copy, guard reasons, RE risk reasons and next-step recommendations,
  server error strings, CLI output, `install.ps1`/`start-majin.cmd`, tool group names
  (`files`/`network`/`screen`). English synonyms added for the self-config intents the bench proved
  were missing; the persona/style matcher lost an empty alternative that silently matched anything.
- Rules: `rules/majin.yar` is seeded into `<home>/rules/` on first run and `pkgRules` is searched
  under pkg, so a fresh exe has working YARA instead of an empty folder.

### Verified
- `npm run check` → 60/60 files parse cleanly. `npm test` → **60/60**. `npm run bench` →
  **7/7 scenarios green**, p50 ≈ 54 ms/turn. `majin doctor` → all rows `✔`.
  `node dist/majin.cjs doctor` (the packaged bundle, exact input to pkg) → all rows `✔`.
- **Not verified:** any Windows behaviour (installer, icon, scheduled task, the exe bytes
  themselves — `pkg` needs GitHub release-asset egress and a Windows toolchain, neither of which
  exists here) and any browser rendering of the UI.

## Earlier on this branch

- Core build-out: provider layer (OpenAI-compatible/Anthropic/Gemini/mock + DeepSeek preset),
  config with validate/backup/redact, agent loop with escalation + compaction, MOA, guard with
  approval queue, memory/skills/sessions, scheduler, Telegram + WhatsApp channels, hardened HTTP
  server (token, redaction, path limits, spill files), classic-script UI, CLI, Windows installer and
  shims, `scripts/parse-all.js` + `scripts/clean.js`.
- Renamed from the working title to **MAJIN** across 62 files (config name `majin.config.json`,
  `MAJIN_*` env vars, `~/.majin` home, `rules/majin.yar`).
