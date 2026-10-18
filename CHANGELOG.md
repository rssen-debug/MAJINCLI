# Changelog

Date headers, newest first. Under each date: **Ändrat** (what changed), **Fixat** (what was
broken), **Verifierat** (the exact command and its result). Verified means the Linux sandbox +
GitHub Actions CI unless stated otherwise; nothing here claims a browser or human Windows click
without saying so explicitly. Version tags map 1:1 to git tags.

## 2026-10-18 (job agent, slice 2: prepare + send — with proof or nothing)

### Ändrat
- **`jobs.prepare`**: opens the application form in the task's own browser context,
  detects fields *generically* (label/aria/placeholder/name words + type gates —
  zero site recipes), fills what can honestly be mapped (contact from the CV,
  overrides as args, the CV file attached to file inputs), and moves the
  application to `waiting`. The answer is the EXACT preview of what would be sent,
  plus a `gaps` list of what still needs a human.
- **`jobs.send`** (risk `destructive` — the guard asks every time in the default
  confirm mode, which is precisely the brief's "approval before every submission"):
  clicks the likeliest submit control by vocabulary, then **demands proof**:
  confirmation words on the result page (sv+en), a saved screenshot in
  `jobs/proofs/`, the resulting URL. Accepted → `submitted` with the proof in the
  history. NOT accepted → the status stays `waiting` and the error says so in
  plain words — an unsent application marked sent is the worst lie this product
  can tell.
- Decoration day: `found → started` is now legal (the user's own override), an
  unsend without preparation is refused, a done application refuses resend.
- **94 tools** (was 92). CI live step now also runs `test/jobs.live.test.js`.

### Fixat
- **`openFor` navigated to `about:blank` on every tool reuse** (since the browser
  foundation): `Page.navigate` returns at initiation, not arrival, so read-after-
  open was an eval-vs-navigation coin flip — green twice, red twice, depending on
  the runner's mood. The live gate caught the flake signature (both suites red in
  the same minute, zero DOM): reuse now returns the handle without navigating,
  and `goto` waits for the document before asking it anything. Source-pinned so
  the race cannot return.
- `extractContact` link capture returned the `www` group instead of the URL
  (linkedin/github always null) — found by the test.
- jobs.live audit before first CI run: prepare is exec-level and would hang the
  guard in the headless runner; both tools test-side auto-approved (risks stay
  pinned).

### Verifierat
- `node --test test/jobs.test.js` → 11 pass, 0 fail (state machine, dedupe,
  match, formfill classification incl. substring traps, proof discipline).
- `npm test` → **208 pass, 0 fail, 7 skipped** · i18n 0/75 · `npm run check` 105/105.
- The end-to-end submit chain (fake employer site → posted fields → thanks words
  → status submitted, screenshot on disk) is pinned in `test/jobs.live.test.js`
  and is **CI-gated from the next build — verdict pending dispatch below**; until
  then it is honestly: written, locally skip-verified, not yet observed by CI.

## 2026-10-18 (job agent, slice 1: the pipeline is real)

### Ändrat
- **Job-search foundation** (`src/core/jobs/` new): the application state machine
  found → matched → started → waiting → submitted/failed (+ skipped). Illegal moves
  throw plain words; `failed` demands a WHY, `submitted` demands PROOF, terminal
  means terminal ("done is done"). Proof-bearing pipeline stored at
  `<MAJIN_HOME>/jobs/applications.json`; a torn store reads as empty, never fatal.
- **Dedupe = the pipeline itself**: fingerprint from canonical URL (tracking junk
  stripped, real job-id params kept) with a title+company fallback folded for case
  and diacritics. A job seen once is a job never re-shown.
- **Deterministic CV-match** with an honest basis: site-tagged skill demands
  (must_have 1.0 / nice_to_have 0.5) when the site provides them, else the ad's own
  words; null = "cannot score this CV", never an invented score. Swedish/English
  skill vocabulary lives behind `svlex(...)` (input data, exempt from the i18n gate).
- **Platsbanken adapter** (public JobTech Dev API, no key): parser built from the
  production wire shape observed today; errors come back shaped, never thrown.
- **7 new tools → 92**: `jobs.search`, `jobs.match`, `jobs.list`, `jobs.start`,
  `jobs.skip`, `jobs.cv.set`, `jobs.cv.show` — params in the house string-shorthand.

### Fixat
- Matcher's label→canon mapping: `'js' ⊂ 'node js'` promoted *javascript* and
  `.net ⊂ kubernetes` promoted *csharp* — now longest whole-word synonym wins;
  both traps pinned by test. (Found by the test I wrote before trusting it.)
- `normalizeUrl` stripped trailing slashes only after the query string; the slash
  lives on the pathname (also pinned).

### Verifierat
- `node --test test/jobs.test.js` → 7 pass, 0 fail, 1 skipped (live gate).
- `MAJIN_JOBS_LIVE=1 node --test test/jobs.test.js` → 8/8, real Platsbanken
  round-trip green in the sandbox (one-time proof; CI does not gamble on the site).
- `npm test` → 204 pass, 0 fail, 6 skipped · `npm run i18n` 0/74 · `npm run check` 103/103.

## 2026-10-18 (ETA lands on the task cards — and the missing wire it exposed)

### Ändrat
- **Task cards now show real telemetry**: elapsed time (the card's own clock, ticking
  1×/s while live, frozen on finish/stop), tool count, and an average ms/tool *only when
  the card itself has measured ≥2 completions*. Nothing is predicted; a number that
  cannot be counted is not shown.
- **Per-task telemetry in the registry** (`toolsRun`, `avgToolMs`, `curTool`,
  `lastTool`) derived from the same event stream the cards see; `/api/tasks` carries
  it, so channel-started task decks can render honest numbers too.
- **`tool_begin` counts** alongside `tool`/`tool:start` in both server tracking and
  card display — the loop had three spellings of "a tool started" and telemetry
  agreed on all of them.

### Fixat
- **The ETA wire that was never connected**: `registry.exec` measured `ms` and put it
  in the tool result, but the loop's `tool_result` *event* dropped the field — so
  `eta.record()` had been called with `undefined` since v0.6.0's telemetry landed and
  `estimate()` could never have produced an interval. Caught in self-review while
  wiring the card display (the display needs the same field). One field, one line;
  the whole pipeline now counts for real. Also `'steg'` in the card footer is gone;
  shipped UI is English end-to-end.

### Verifierat
- Live browser gate flipped to hard: two consecutive green CI runs on the Windows
  runner (39 119 535 069 + 39 120 606 397) after it caught a real `openFor` bug.
- `node --test test/tasks.test.js` → 8 pass, 0 fail (failing test written before fix).
- `npm test` → 197 pass, 0 fail, 5 skipped · `npm run i18n` 0/70 · `npm run check` 98/98.
- Human/browser round still owed for the visual card tick (no DOM harness here —
  stated, not hidden).

## 2026-10-18 (teamwork: NL fleet commands + real ETA telemetry)

### Ändrat
- **Natural-language fleet routing** (`src/core/intent-tasks.js`, new): sentences like
  "pausa hemsidan", "agent 2, hjälp agent 1", "alla hjälpa jobbsökningen", "visa alla
  agenter" are parsed **deterministically over live task refs** (ordinals "första/andra/
  tredje", "agent N", name stems) — zero model calls for stop/pause/resume/assist/status.
  Anything that is not a fleet command falls through to the model untouched.
- **`/api/chat` intercepts fleet commands** when no explicit task is addressed: stop = the
  task's own stop; pause = stop + status `paused`; resume/assist = a brief fired into the
  SAME session in the background (assist fans out to every other running agent on "alla").
  Non-commands still create/continue tasks exactly as before.
- **Real ETA telemetry** (`EtaMetrics` in `tasks.js`): every `tool_result` records its
  measured ms under the tool name (ring of 100). `estimate()` returns an **interval**
  {n, avgMs, loMs, hiMs} only after two real runs of the same tool, otherwise null —
  "hard to estimate" is a valid answer, invented numbers are not. Exposed at
  `/api/tasks` under `telemetry`.

### Fixat
- None (new capability).

### Verifierat
- `node --test test/intent-tasks.test.js` → 4 pass, 0 fail (incl. empty-fleet honesty).
- `node --test test/server.test.js` → 9 pass, 0 fail (fleet commands over real HTTP).
- `npm test` → **196 pass, 0 fail, 5 skipped** (5 = env-gated browser live suite).
- `npm run i18n` → 0 Swedish literals / 70 files (parser vocab allowed as input data).

## 2026-10-18 (browser-use: upload + smarttab + the live wire)

### Ändrat
- **`browser.upload`** (DOM.setFileInputFiles over CDP): a file is attached to a page
  `<input type=file>` and the confirmation is read back from the input element itself —
  the CV-upload path the job agent will need. 84 → **85** tools.
- **Smarttab**: a click that spawns a new tab (target=_blank / window.open) is followed
  within 1.5 s — the agent never keeps acting on the stale tab. Session routing reads
  the live target dynamically (`send` now re-reads `b.sessionId` per call).
- **Recovery cookbook in the system prompt**: failures recover in deterministic order
  (read → narrower selector → shot once → retry/ask; no more than two clicks on the
  same failing element — three trips the loop guard).
- **CI live wire**: the exe job runs `test/browser.live.test.js` on the real Windows
  runner (Edge + node 22 exist there) with a deterministic local form server —
  `continue-on-error: true` for the first runs by design, gates once stable (noted in
  the workflow itself).

### Fixat
- **`close is not defined` in `openFor`** — my smarttab refactor dropped the `close()`
  definition; only a REAL browser run could see it, and the brand-new CI live step did
  (Windows runner, first dispatch). Restored, plus a safety net: any failure between
  browser spawn and session-ready now kills process/ws and returns the pool slot — the
  leaked handles had held the runner step for 18 minutes.
- My own closure bug: `send` captured the initial tab's sessionId, which would have
  broken smarttab the one time it matters — found during review before running.

### Verifierat
- `node --test`: **190 pass / 0 fail / 5 skipped** (adds `test/browser.test.js` 7/7:
  upload risk-pin, followNewTarget source-pin, cookbook pins); `npm run i18n` 0/69
  files; `npm run check` 96/96. LIVE e2e intentionally skipped locally (no browser in
  the sandbox, node 20 has no built-in WebSocket); its wire proof is owed by the next CI run.

## 2026-10-18 (browser-use foundation) — the agent drives the browser that is already on the machine

### Ändrat
- **New module `src/core/browser.js`** — CDP (Chrome DevTools Protocol) over Node≥22's built-in
  `fetch`+`WebSocket`, against the Chrome or Edge the user already has. No npm dependency,
  no bundled rendering engine, no Python. Everything WebSocket-shaped is lazily constructed, so
  the module loads on older runtimes and fails with a sentence, not a crash.
- **Six tools** (`browser.open/read/click/fill/shot/close`, group `web`): one window with one
  profile directory per agent session (isolation by construction — two agents never share a tab),
  global fleet cap via the task-layer locks (`browser.maxInstances`, default 3 — a fourth session
  queues honestly), `exec`-risk labeling so guarded mode asks before acting.
- **Deterministic loop guard**: `journal.guard()` throws on the third identical consecutive
  browser action — the stuck-42-retries pattern dies in code, not in retries with better luck.
- **Evidence in every answer**: click returns element tag+text and the URL after the click,
  fill returns that the value stuck in the page, read returns the page's own words, shot saves
  a real PNG in the workspace. Nothing reports "done" on faith.
- Tool count 78 → **84** (pins moved accordingly).

### Fixat
- Browser-use existed only as "open the user's default browser" (`majin.ui`) — the brief's
  agent-driven click/fill/verify did not exist at all. Now it does, with autopilot-safe
  isolation (test G requirement) designed in from the first line.

### Verifierat
- `node --test`: **189 pass / 0 fail / 4 skipped**. `test/browser.test.js` 6/6: loop guard
  (3-in-a-row throws, intervening action resets, sessions isolated), slot pool (FIFO claim,
  honest "all busy" on cap-exceeded, idempotent re-claim, full release), discovery tables
  (platform candidates, honest null), closed-fleet answers sentences.
- `node --test test/no-dead-tools.test.js`: 4/4 — all six tools complete + model-visible.
- NOT yet verified against a real browser end-to-end on CI Windows (chromium-headless agent
  turn) — tracked in TODO Hög prioritet; the CDP wire is thin but unproven by suite.

## 2026-10-18 (autopilot UI) — the S.busy wall is down

### Ändrat
- **The chat no longer blocks while MAJIN works.** In `src/ui/app.js` the gate
  `if (!input || S.busy) return false;` is replaced: a new message sent during
  a running task becomes its own parallel task (POST `{autopilot:true}`), and
  slash commands (incl. `/stop`) reach the engine even while busy.
- **Task cards in the chat.** Every parallel message gets a card with the
  server's task id, live status (working/waiting/done/error/stopped — the
  registry's vocabulary), rolling activity line (route/step/tool), streaming
  answer text (~6 paints/s), and its own ⏹ stop button that posts
  `{task: rec.id}` to `/api/chat/stop` and aborts only its own stream.
- Cards read the real SSE `event: NAME` lines (the classic parser looked at
  `data:` only) so the UI binds the resumed stream to the exact task id the
  server named — a stopped second task can never kill the first.
- App language is English in the new surface (plus repo-wide i18n gate holds).

### Fixat
- The long-standing single-stream assumption (`S.busy`, `S.abort`, `S.cur`)
  made a second message vanish silently or freeze the composer — measured in
  code, now pinned by a stability test.

### Verifierat
- `node --test`: **183 pass / 0 fail / 4 skipped**; `npm run i18n`:
  0 Swedish literals in 68 files; `node --check src/ui/app.js` clean;
  contract test pins: no `S.busy` gate, `{autopilot:true}` send,
  stop-by-task-id, task-event binding, all status styles present in the
  palette. UI painting is *not* browser-rendered here (coverage = string
  contract + server wiring); first human click-check is listed in TODO.

## 2026-10-18 — v0.5.3 shipped + autopilot core (backend) on `main`

### Ändrat
- **The silent-update relaunch belongs to our code, not to Inno.** The one-click updater now
  spawns a hidden, detached PowerShell watchdog (`src/core/update.js`, `relaunchScript` /
  `relaunchCommand`) next to the installer: it waits for the installer PID to exit (15-min
  deadline), stops leftover `majin-win-x64` processes, starts the new build
  (`start --no-window`) and logs every step to `%LOCALAPPDATA%\MAJIN\update-relaunch.log`.
  `-EncodedCommand` (base64/UTF-16LE) makes quoting unbreakable. v0.5.3 is live:
  `releases/tag/v0.5.3` @ `a6cbf39`.
- **Autopilot core (backend)**: new `src/core/tasks.js` — a deterministic `TaskRegistry`
  (task id ↔ its own session id, status machine running/paused/waiting/done/error/stopped,
  capped event trail, awareness snapshot) and `fileLocks` (FIFO per-file lock, owner re-entry,
  30 s timeout). `agent.turn` already serialized per *session*, so every independent task
  getting its own session yields real parallelism, isolated history and per-task stop without
  touching the engine. `/api/chat` creation/routing: `body.autopilot:true` starts a fresh task,
  `body.task:<id>` rejoins that task's session (never a duplicate), every turn emits
  `event: task` and is tracked in the registry; `POST /api/chat/stop {task}` stops exactly one
  task; `GET /api/tasks` is the dashboard feed (tasks + live file locks).
- **Shared awareness, zero-LLM.** Each turn's system prompt can carry a `SIBLING TASKS` block
  built from the registry — id, status, input head and the files the task holds right now —
  so an agent can plan around its siblings instead of colliding with them.
- **Files are now collision-safe for parallel agents.** `fs.write`/`fs.patch`/`fs.copy` run
  their writes under `fileLocks` (owner = task session), whole read-modify-write for
  `fs.patch`, and tmp-then-rename atomic writes so a killed task never leaves a torn file.
- Registry guard: an unknown status string throws even on terminal tasks (was silently swallowed).
- Installer keeps `skipifsilent` on the postinstall entry again (see Fixat) with a comment that
  names the CI evidence; interactive installs still auto-start MAJIN via the hidden checkbox run.

### Fixat
- **User-reported on real Windows:** `Setup — Unable to execute file …MAJIN.vbs — CreateProcess
  failed, code 193`. A `.vbs` is not a Win32 program; all launch points (start menu, desktop,
  autostart) now go through `wscript.exe` with the vbs as argument, M-icon intact.
- **CI-proven twice, 17+18-minute hangs**: a *silent* install that launches the app from Inno's
  postinstall hangs the setup process until the job timeout kills it (orphan `majin-win-x64` +
  `conhost` in both job logs — tried once with wscript, once with `runhidden` exe; same result).
  Fix: Inno never starts the app in silent mode; the updater watchdog (above) performs the
  relaunch. First v0.5.3 attempt also hit an Inno quote-grammar wall (5-quote cluster rejected
  on ValueData) — kept at 4.
- The v0.5.2-era chain silently died after one-click updates (postinstall `skipifsilent` meant
  the app never restarted and looked dead) — now handled by the watchdog chain end-to-end.

### Verifierat
- `node --test` (full suite): **182 pass / 0 fail / 4 skipped** locally at `v0.5.3`+autopilot
  (was 176 at v0.5.2; +6 autopilot tests).
- CI run `39111598323` returned `completed success` → run `39113481797` success →
  `releases/tags/v0.5.3` has 4 assets: `MAJIN-Setup.exe` 23.72 MB, `majin-win-x64.exe` 97.41 MB,
  both `.sha256`, published 2026-10-18T09:02:42Z.
- CI Windows smoke (job "the installer must install, run, survive a restart and uninstall"):
  silent install OK → `majin 0.5.3` served (78 tools, window + chips) → port stop clean →
  config survived (`name=verify-090215`) → uninstall removed program files, kept user data,
  removed Desktop icon → reinstall OK. Icon line: `now carries 7 size(s) at id 1`.
- `test/tasks.test.js` 6/6 — registry semantics; same-file FIFO queuing; different-file
  measured concurrency (peak ≥ 2); lock timeout + owner re-entry; **A:** three real scripted
  turns share wall-clock with isolated `task:*` session files and zero history bleed;
  **E:** stopping one task completes its `aborted` result while the second task returns its
  full answer; **B:** two concurrent `fs.patch` calls on one file — both edits land, no lock
  leaked.
- Watchdog script byte-verified on Linux: `relaunchCommand` output base64-decodes to the exact
  script (the same decode path PowerShell uses).
- Not yet verified by a human on Windows: update chip → relaunch UX. CI covers the mechanics.

## 2026-10-17 — v0.5.0, v0.5.1, v0.5.2 + the onboarding rounds

### Ändrat
- **0.5.2** added `majin.doctor` (human-facing capacity health, no network: per-capacity
  `OK/FIX/NOTE` with the exact tool/card that fixes it) and the meta-test `no-dead-tools`
  (all 78 tools complete, model-visible via `registry.schemas()`, readOnly-safe — locked in CI).
- **0.5.0 "Trust & Flow"**: `cfg.get()` returns clones (no more live-config mutation);
  provider lifecycle complete (multi-add, key replace, remove with automatic route repoint —
  or an honest "run setup again"); per-session serialization (`src/core/serialize.js`) so five
  fast messages never interleave while telegram/desktop/vision stay parallel; `moa.policy`
  default `'off'` (opt-in, no hidden 3× spend); build refuses to ship an exe without the pink
  M (hard error if resedit does not report `now carries`); hidden `MAJIN.vbs` launcher
  (wscript, window style 0) kills the console window; ⏻ Quit button truly stops the server;
  downloaded installers sha256-verified against the release hash and refused on mismatch;
  wizard is skip/reopen/remove-friendly; parallel tool results land on their own rows
  (`toolRows` map).
- **0.5.1**: `.sha256` sidecars written by the build scripts themselves (installer + exe), so
  the release glob cannot miss them.
- Onboarding round (unreleased-then 2026-10-17, shipped inside 0.5.x): every provider failure
  is one sentence via `explainError()` (classifies `no_key|auth|billing|model|toobig|rate|
  unreachable|upstream|provider`); permanent failures stop instead of retrying; first answer on
  a fresh install is an answer (127 ms, one step) with no MOA scaffold leakage; `needsSetup`
  turns MOA off per turn; Providers card carries all 11 presets from `state.presets` +
  address box + *get a key ↗* link; empty key box refused with the right sentence;
  `resolveModel()` carries labels.
- Dataset capture shipped (`src/core/dataset.js`): consent-first local JSONL, redaction before
  write with no switch, per-turn "do not save this" opt-out, `keepDays` trim, verdict-only
  turns as labels, **no upload code path at all** (`dataset.upload` rejected by validation).
- `majin start` forwards the flags you actually typed (`--host`, `--no-browser`,
  `--no-channels`); WhatsApp/Baileys backs off (3s→300s cap) and gives up after
  `channels.whatsapp.maxRetries` when nothing ever paired; `/api/selftest` no longer paints a
  fresh install red; mentioned API keys no longer sneaked into config (intent-word proximity
  rule, message-only-key still configures default).

### Fixat
- **0.5.1**: `set-icon.mjs` main-guard used `new URL(import.meta.url).pathname` — on Windows
  that is `/D:/a/...` and never matches `process.argv[1]`, so two releases shipped the default
  icon with exit 0 and zero output. Now `fileURLToPath` + a permanent regression test.
- **0.5.0 root disease**: `cfg.get()` leaked live config data behind validation and the
  deep-merge could never delete a nested key — removed providers survived, adds never hit disk,
  remove lied. Replaced with clone-on-get + the undefined-sentinel deletion the validator
  understands; a gemini-kind validation gap closed with it.
- Installer checksum flow was dead code (broken brace block hashing the *old* file on disk
  instead of the downloaded bytes) — both faults repaired.
- The GitHub-action icon log literally printed `icon: no output` (source of the user's "old
  icon").
- A dozen shipped Swedish strings (Telegram approval prompt, provider/schedule/skill results,
  `install.ps1` Node check + uninstall steps, the TCP timeout line) and the i18n word list's
  missing inflections (`borta/borttagen`, `svarar/svarade/svaret`, …) — caught by the gate now.

### Verifierat
- 0.5.x: `node --test` 173 tests (158 pass) at 0.5.0; releases v0.5.1+v0.5.2 published with
  4 assets each; installer + exe icons verified in job logs (`now carries 7 size(s)`); CI runs
  `39086544929` (0.5.2) success.
- Onboarding round: `node --test` **97/97**, `npm run check` 67/67, `npm run i18n` 0 in 57
  files, `npm run bench` 7/7 `VERDICT: pass`; `dist/majin.cjs` rebuilt and re-run on a second
  fresh home (11 presets incl. `kilocode`, first answer, empty-key refusal, doctor green).
- Explained: everything above verified in the Linux sandbox; Windows/browser rendering and live
  provider/channel traffic were still marked unverified at this date (see 2026-10-18).

## Tidigare (2026-06-18 → 2026-10-16) — version entries kept verbatim

### Ändrat / Fixat
- **0.4.3** — wizard save fixed root-caused (server looked up `preset`, wizard sent `name`;
  now posts `preset`, surfacing errors+hints verbatim) + a first-class **Custom endpoint**
  card (any OpenAI-compatible URL + key through `majin.provider`, no parallel system).
- **0.4.2** — header always shows the running version; installer force-closes a running MAJIN
  before replacing files (PrepareToInstall → taskkill). Never upgrade into your own ghost.
- **0.4.1** — header STOP leaves Simple mode (composer RUN becomes STOP instead; the extra
  brake stays behind the expert toggle).
- **0.4.0** — first-run wizard (`src/ui/onboard.js`, opens only on `needsSetup`: provider card
  → key → save&test → live model list → start), header model picker from the provider's own
  `/models` catalogue, single-model default written to every route with MOA off
  (`test/singlemodel.test.js` proof), config `patch()` validates against merged data.
- **0.3.0** — Imagination Engine slice 1: Live Agent Vision (real event stream as timestamped
  timeline: route/tool/approval/usage/answer), Living Core orb reflecting real state, zero
  extra model calls, textContent-only (model text never becomes markup), reduced-motion,
  fresh canvas per run.
- **0.2.1** — update checker pointed at the archived `rssen-debug/slurps` (never published a
  release → every install looked forever-fresh); default now `rssen-debug/MAJINCLI` with on-sight
  migration. `UsePreviousTasks=no` so an unchecked desktop-icon box stops reproducing forever;
  publisher/support URLs + README links de-archived; the no-network update test made
  deterministic.
- Dataset capture, `$majin.skill`, channels and RE tooling foundations landed across the
  2026-10-17 late rounds (details in git history; the upload-free dataset contract stands).

### Verifierat
- 0.4.0: onboarding structure + single-model resolution + add→models→test flow tests;
  0.3.0: slice-1 layer test-verified inert when removed; 0.2.1: deterministic update tests.
  (Exact per-version suite numbers live in the tags' own CI runs.)
