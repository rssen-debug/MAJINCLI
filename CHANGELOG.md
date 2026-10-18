# Changelog

Notable changes on `arena/e223e8b9-slurps` (PR #1). Newest first. Verified in the Linux sandbox
unless stated otherwise; nothing here claims a Windows or browser run.

## 0.5.3 — hotfix: installationen kan starta MAJIN igen + tyst one-click-update startar om appen

Användarrapporterat på riktig Windows: `Setup — Unable to execute file
C:\Program Files\MAJIN\MAJIN.vbs — CreateProcess failed, code 193`.
En .vbs är ingen Win32-exe; Inno Setups postinstall körde `CreateProcess`
direkt på den. Start-meny, skrivbord och autostart går nu via
`wscript.exe "{app}\MAJIN.vbs"` med M-ikonen kvar — postinstall kör i
stället exen direkt med `runhidden` (CI-bevis: en postinstall-wscript
hängde den tysta installationen i 17 minuter på runnern; Inno döljer
konsolen lika bra själv). Test låser: ingen launchpoint får någonsin
peka rakt på vbs:en, och postinstall är runhidden-exe.

Samma runda: `skipifsilent` på postinstall betydde att den **tysta**
one-click-uppdateringen (VERYSILENT) stängde appen utan att starta den igen
— efter en lyckad uppdatering såg MAJIN död ut. Flaggan är borta: uppdatera
inne i appen → installern kör tyst → MAJIN startar av sig själv. Det är
kedjan som hela tiden var tänkt.

## 0.5.2 — majin.doctor + kontraktet "inga döda tools" (78 tools, alla levande)

**`majin.doctor`** — människovänd hälsokoll inspirerad av Agent-Reach:s
`doctor`-mönster. Inga nätverksanrop, alltid svar: per kapacitet
`OK` / `FIX` / `NOTE` med exakt vilket verktyg eller kort som lagar problemet
("no provider has a key → majin.provider({action:"add"...})"). Användbara
verktyg föder använda verktyg.

**Meta-testet `no-dead-tools`** låser i CI att VARENDA tool i registret:
komplett (namn/grupp/desc/JSON-schema/run/risk), modell-synligt via
`registry.schemas()` (det flöde som matar provider-API:t — exakt paritet
krävs), och filter-säkert i readOnly-läge. 78 tools, noll döda — nu och
för all framtid.

Repo-granskningen (14 länkar): alla existerar, alla är Python/TS-*mönster*.
Agent-Reach:s doctor+zero-key-läsning och Bekanta-mönstren är omfamnade;
browser-use et al. är bibliotek som skulle bryta "ingen Python-dependency"
(VNEXT §13) — mönstren tas, inte ramverken.

## 0.5.1 — hotfix: ikon-fixen funkar på Windows också + checksum-filerna kommer med

v0.5.0's "vägra skeppa default-ikon" var rätt inställning avslöjade det riktiga
monstret: `set-icon.mjs` gjorde sin main-guard med
`new URL(import.meta.url).pathname` — på Windows är den `/D:/a/...`, som
aldrig matchar `process.argv[1]` → skriptet laddade och dog tyst, exit 0,
noll output. Två releases skeppade standardikon exakt därför. Nu
`fileURLToPath` (och ett test som spärrar regressionen för alltid).
`.sha256`-sidecars skrivs nu av själva byggskripten (installer + exe), så
release-globben inte längre kan missa dem.

## 0.5.0 — "Trust & Flow": provider-hantering som aldrig ljuger, ikonen på plats, inget konsolfönster

Den här versionen tog varje granskningsfynd och dina egna bugrapporter och
slog dem i stål — med tester som låser beteendet, inte bara kod.

**Allvarligaste buggen någonsin hittad: `cfg.get()` läckte LEV CONFIG-DATA.**
Varje kodrad som gjorde `const p = cfg.get('providers'); p[x] = y` muterade
konfigen BAKOM validering och säkerhetssparning. Till råga på allt är
`merge()` en djup-merge som aldrig kan radera en nästlad nyckel — så
"ta bort provider" skickade en ren karta som sedan mergades rakt tillbaka
över gamla datan. Resultatet: borttagna providers överlevde i minnet, add
"lyckades" i minnet men skrevs aldrig till disk, och remove loggade stolt
"removed provA" fast inget ändrats. Nu: `get()` returnerar en klon,
provider-remove använder den enda sanna raderingsmekanismen
(undefined-sentinelen, som validatorn nu förstår), och gemini-kind validerar.

**Provider-livscykeln är komplett:** lägg till flera, byt nyckel (samma add
skriver över — gamla nyckeln försvinner), ta bort. Tar du bort providern som
rutterna pekade på repointas de automatiskt till något som faktiskt kan
svara (din egen provider med nyckel först, sedan keyed presets, sedan
lokala) — eller så säger appen rent UT att du måste köra setup igen. Aldrig
mer tysta spökrutter. Allt testat end-to-end mot en riktig Config+fil.

**Fem meddelanden samtidigt:** samma session köas nu genom en per-nyckel
promise-kedja (`src/core/serialize.js`) — fem snabba meddelanden på desktop
kan ALDRIG flätas in i varandra, medan telegram/desktop/vision fortfarande
kör parallellt. Racefönstret är stängt.

**MOA är opt-in, som utlovat.** `moa.policy` defaultade till `'always'` —
en färsk installation brände 3x tokens utan att någon bad om det. Nu `'off'`.
ChatGPT-auditingen hade rätt.

**Installern bär ÄNTLIGEN ikonen.** CI-loggen visade bokstavligen
`icon: no output` — exen skeppades med standardikon ("gamla ikonen" du såg).
Bygget vägrar nu skeppa en exe utan vår rosa M (hårt fel om resedit inte
bekräftar "now carries"). Din skrivbordsikon blir rosa nästa install.

**Inget konsolfönster, och Quit dödar verkligen servern.** Shortcuts +
Run-post går nu via en dold `MAJIN.vbs`-launcher (wscript, fönsterstil 0) —
svart cmd-ruta borta. Huvudfönstret har en ⏻-knapp (arm → POST /api/shutdown
→ stäng) så node-processen dör när du tror att appen stängts.

**Nedladdade installrar verifieras på riktigt.** CI publicerar
`MAJIN-Setup.exe.sha256`; uppdateringsflödet hashas BYTES som kom över
tråden mot releasens hash och vägrar spara vid mismatch. (Kedjan låg död i
ett trasigt klammerblock fram till nu — hashas dessutom gamla filen på
disken istället för nedladdningen; båda skroten reparerade.)

**Wizardn är inget fängelse:** Skip for now (session-only, aldrig
localStorage), återöppningsbar via länken i modellväljaren, konfigurerade
kort visar "configured ✓ — click to change the key", och varje kort har en
fungerande remove-knapp.

**Parallella tool-resultatlandningar på rätt rad.** `currentToolRow` var en
enda pekare — två verktyg samtidigt målade sitt resultat på samma rad. Nu
ett Map per verktyg.

Tester: 173 (158 pass, 2 skip,+13 nya låsta beteenden), parse-gate, i18n-gate.

## 0.4.3 — the wizard actually saves your key + custom endpoints

Root cause of "could not save": the server looks a provider up by the
`preset` field, the wizard sent only `name` — no preset found, no baseUrl,
a 422, and the UI swallowed the server's own helpful message. The wizard now
posts `preset`, surfaces errors+hints verbatim, and gained a first-class
**Custom endpoint** card (any OpenAI-compatible URL + key, saved through the
same provider tool — no parallel system).

## 0.4.2 — never upgrade into your own running ghost

- The header now always shows the running version (`v-tag`, filled from the
  served version) — after an update you can SEE that you are on the new one.
- The installer force-closes a running MAJIN before replacing files
  (PrepareToInstall → taskkill), so the old process can no longer survive an
  upgrade and keep serving the old window on the old port.

## 0.4.1 — the header stop button leaves Simple mode

The RUN button in the composer already becomes STOP the moment a task runs,
so the emergency stop in the top-right is now hidden in the default view
(behind the expert toggle it stays — an extra brake for power users).

## 0.4.0 — Phase B: first-run onboarding, model picker, single-model proof

The simple experience on top of the systems that already existed:

- **First-run wizard** (`src/ui/onboard.js`): opens only when `/api/state` says
  `needsSetup` — pick a provider card (from the live preset list, nothing
  hardcoded), paste the key (skip for keyless locals), Save & test runs the
  real provider `add` + `test` actions, then a searchable live model list and
  Start. Three steps, plain-language errors, never shows a key back.
- **Header model picker** (`c-model` chip): searchable dropdown fed by the
  provider's own `/models` catalogue (cached per session), one click switches
  the model MAJIN actually runs.
- **Single-model mode by default**: onboarding writes the chosen model to
  EVERY route and turns MOA off — no hidden second-model spend. Proof:
  test/singlemodel.test.js asserts every job resolves to the one ref and
  survives a restart-shaped reload.
- **Fix:** config `patch()` rejected routes when the provider was introduced
  in the same patch (validated pre-merge); now validates against merged data.
- **Fix:** the deterministic offline update test was also load-bearing for
  CI stability.
- Tests: onboarding structure, single-model resolution, and a full
  add→models→test provider flow against a local stub (no open internet).

## 0.3.0 — Imagination Engine, slice 1: Live Agent Vision + the Living Core

The first real step of the V3 spec (docs/IMAGINATION.md): the window now shows
the agent's work as a living, timestamped timeline fed by the REAL event
stream — route choices, tool starts/ends, escalations, approvals, usages and
the final answer — plus a small Living Core orb that reflects the actual
state (ready/thinking/working/waiting for you/done/error).

- Pure local rendering: zero extra model calls, zero extra network, no timers,
  no simulated activity. An idle agent shows an idle core.
- Model text can never become markup in the canvas (textContent only), steps
  expose real payloads behind native <details> (keyboard-accessible).
- Reduced-motion respected; the whole layer is guarded and test-verified to be
  inert if removed. Plain chat flow untouched.
- A new run starts with a fresh canvas: an old task can never paint over it.

## 0.2.1 — update checks that actually find updates, shortcuts that come back

- **Critical:** the update checker defaulted to the archived first repo
  (`rssen-debug/slurps`, which never published a release), so every installed
  MAJIN looked "never outdated". Default is now `rssen-debug/MAJINCLI`, and a
  config written by an older version is migrated on sight and persisted.
- **Installer:** `UsePreviousTasks=no` -- an unchecked "desktop icon" box from
  an old install no longer reproduces itself forever, leaving people with no
  way to start the app. Start Menu shortcut stays unconditional.
- Installer publisher/support URLs pointed at the archived repo; now MAJINCLI.
- README download/clone links pointed at the archived repo; fixed.
- The "no network" update test is deterministic now (impossible repo), which
  caught only because the repo fix above made the sandbox actually reach GitHub.

## Unreleased — 2026-10-17 (onboarding)

Run as a beginner, not as a developer: an empty data home, a local stand-in gateway that counts every
request, and the four failures an ordinary person actually meets. Each fix was written as a failing
test first (`test/onboarding.test.js`, 10 tests, red before green) and stayed under five files.

### Changed
- **Every provider failure is one sentence with a next action.** New `explainError()` in
  `src/core/provider/chat.js` classifies `no_key | auth | billing | model | toobig | rate |
  unreachable | upstream | provider` and is the only place that wording lives. Measured before → after
  against the same gateway: rejected key `Provider error after 4 failures: 401: invalid or missing API
  key` (4 steps, 4 gateway calls, the retry count printed in the user's face) → "DeepSeek rejected the
  API key — it is wrong, deleted, or from another account. Open the Providers card (right side), paste
  the key and press test." (1 step, 1 call, 33 ms); `402` → out of credit, with the other providers offered; `fetch failed` → "I cannot
  reach DeepSeek. Check that this machine has internet"; an unknown model name names the model; an
  over-long thread says start a new chat or ask for a summary. `errorKind` and `errorHint` ride along
  on the turn result, the SSE `error` event carries `kind`, and `/api/provider/test` returns it too.
- **Permanent failures stop instead of being retried.** 401/402/403/404, a missing key and an
  over-long context end the turn at once (`stop`); 429/5xx and network errors keep the backoff.
- **The first answer on a fresh install is an answer** (127 ms, one step): demo mode says so plainly
  and points at the Providers card. Gone: `Demo answer (mock):`, `QUESTION:`, and the MOA scaffolding
  (`EVIDENCE FROM THIS TURN`, `ANSWERS FROM 3 REFERENCES`) that used to be what a new user read.
- **No model chain while setup is unfinished** — `needsSetup` turns MOA off for the turn
  (`moa.skipped: 'setup'`), so a demo never spends five calls on echoes of itself. `test/agent.test.js`
  seeds a dummy key so the MOA path stays covered by tests.
- **The Providers card now carries all eleven presets and an address box.** `GET /api/state` gained
  `presets` (`presetCard()` in `presets.js`) and `src/ui/panels.js` builds the dropdown from it — the
  old hardcoded list of nine made `kilocode` and `nous` unreachable from the browser. Each preset
  brings a *get a key ↗* link, and the address field covers Ollama, LM Studio and your own machine,
  which previously meant "write it in the config".
- **An empty key box is refused, not reported as saved.** `needsKeyFor()` is the single rule behind
  both `majin.provider add` and `POST /api/provider`: the demo needs no key, `ollama`/`lmstudio` ship
  a dummy, and any loopback or RFC1918 address counts as yours; everything else gets
  `no key pasted — Groq needs one` plus where to get it, and nothing is written.
- `resolveModel()` carries `label`, so a message names DeepSeek rather than `deepseek`.

### Fixed
- A dozen Swedish strings in shipped output that the i18n list had walked past, now including the
  approval prompt sent to Telegram/WhatsApp users (`Svara: /ja 12 · /nej 12` → "Reply with /ja 12 to
  allow it · /nej to refuse"), `majin.provider` results (`ange name`, `Testa:`, `tog bort … Kvar:`,
  the `svara OK` probe, `svarar inte`), `majin.schedule/skill` removal lines, `scripts/clean.js`, the
  Node check inside `install.ps1` (now names nodejs.org) and its uninstall steps.
- The gate itself got inflected forms (`borta/borttagen`, `svarar/svarade/svaret`, `kvarvarande`,
  `testar/testade`, `notera`), which then caught the TCP timeout text in `tools/net.js`
  (`… svarade inte inom 5000ms` → "did not answer within 5000ms", the string a user reads when a port
  is closed) and the provider-test summary in `majin.provider`. A word list only matches what it
  knows: without inflections it quietly approves half the language.

### Verified
- `node --test test/*.test.js` **97/97** (was 87), `npm run check` 67/67, `npm run i18n` 0 in 57
  files, `npm run bench` 7/7 `VERDICT: pass`. `dist/majin.cjs` rebuilt (576,208 B) and re-run on a
  second fresh home: 11 presets incl. `kilocode`, the new first answer, empty-key refusal,
  `majin doctor` green with 77 tools. Still unverified: Windows, browser rendering, live providers,
  live channels.

### Docs
- README "First run" rewritten — it described a **key required** card that is not a setup card at
  all; the section now is the measured browser path. `docs/CONFIG.md` gained three bullets (state
  carries `presets`, `needsKeyFor`, `explainError` as the one home of failure wording). **`DECISIONS.md`
  added**: the product, measurement, failure-wording, setup and language decisions, with the numbers
  that justified them and a list of what is deliberately left undone.

## Unreleased — 2026-10-17 (later)

Run-driven again: wired **Kilo Gateway** as a provider and tried to run it for real, which exposed
three bugs in code that had never been looked at that way. Also the read-only background turn and
`re.spec`, both taken from how Dots/Muse/REA/Grok Bot are used: a background agent that may look but
not touch, and an investigation that ends in a spec with evidence instead of a story.

### Added
- **`kilocode` provider preset** (11 presets now). `https://ai-gateway.kilo.ai/api/v1`, Bearer **JWT**
  key (the dashboard key *is* a JWT, so `parseIntent` now accepts `eyJ….….…` in natural language and
  maps "my kilo key is …" to the `kilocode` provider), `:free` model ids pass through untouched, and
  `majin provider models kilocode` / `POST /api/provider {action:"models"}` pulls the catalog from
  `GET /models` and saves it in config. Gateway model ids keep the vendor prefix
  (`kilocode/anthropic/claude-sonnet-4.5`) because `splitModel` only consumes the first segment.
- **Read-only turns.** `registry.visible/schemas/list/groups({readOnly})` show only `risk:'read'`
  tools, `registry.exec` refuses everything else with `read_only` + a hint saying how to allow it,
  and the system prompt states the constraint instead of promising every tool. Exposed per job
  (`majin.schedule add … readOnly:true`) and as a default (`schedule.readOnlyDefault`, **false** so
  no existing job changes behaviour). This is the Dots/Muse pattern: background work is read-only
  unless you say otherwise.
- **`re.spec`** (77 tools now) — turns a finished RE investigation into
  `out/spec/<file>.<feature>.SPEC.md`: observable behaviour, inputs/outputs, formats/invariants,
  error handling, an `Uncertain` list of what static analysis could not prove, and an evidence index
  where every claim keeps its `@0x…` offset. `risk:'write'` on purpose (it writes a file) so a
  read-only job cannot emit one. The rule "re-implement, do not copy" is in the document, not just
  the docs.
- `test/i18n.test.js` + `scripts/i18n-check.mjs` — a Swedish gate that scans *string literals* in
  `src/`, `scripts/`, `install.ps1` and `start-majin.cmd`, skips regex literals (input matchers) and
  an allowlist of deliberate Swedish-for-input lines, and fails on both word matches and `åäö`.
  Third translation pass was needed because a diacritic-only detector cannot see `fil`, `klippt`,
  `svar`, `ingen`, `redan` — the gate is the fix, not another sweep.
- `test/kilo.test.js` (8) and `test/readonly.test.js` (6): the gateway contract is asserted against
  a local stand-in that validates the Bearer JWT, so path, header, body, `:free` id, tool round-trip,
  401/402 mapping and `/models` discovery are covered without network; read-only covers refusal, the
  shrunken menu, a surviving turn, the schedule flag and the model override.

### Fixed
- **Streaming turns recorded no usage.** `openaiStream` returned the provider's raw
  `{prompt_tokens, completion_tokens}` object where the tally reads `input`/`output`, so every
  streamed answer counted `0` in `majin usage` and in the budget check (non-streaming calls were
  fine, which is why tests never saw it). Normalised through `usage()`, which now also accepts
  `{input,output}` and reports `total`. Costs recorded before this are understated.
- **A `stream:true` request answered with plain JSON produced a blank reply.** The SSE parser found
  no `data:` lines and the turn "finished" with empty text and no tools. Now: a non-`event-stream`
  content type is read as a normal completion, and a stream that carries nothing at all raises
  `sent an empty stream` with the model-id/baseUrl hint instead of answering nothing.
- **`majin test` was broken on Node 22** — it passed the `test/` *directory* to `node --test`, which
  wants files, so the shipped CLI's own test command died with `MODULE_NOT_FOUND`. It now enumerates
  `*.test.js` and, in a single-file build where no test folder ships, says so in one line.
- **A job's `model` field was decoration** — `runTask` accepted it and `agent.turn` ignored it, so a
  scheduled job could never pin a model. `turn({model})` now overrides the route and the `route`
  event shows it (test asserts both).
- **`POST /api/provider` ignored `action`** — `list|models|delete` only existed on the tool, so the
  UI panel could not discover models for a gateway. It delegates to `majin.provider` now, so UI and
  agent cannot disagree about what a provider is.
- **`POST /api/provider/test` sent an empty model id** when only a provider was given
  (`kilocode/` → gateway 400, looking like a broken install); it defaults to the provider's first
  model. Its probe prompt was Swedish (`Svara med exakt: OK`) — English now.
- **Self-config was silent outside the window.** A patch applied from natural language only emitted a
  `config` event, so a Telegram/WhatsApp user got an unrelated answer; the answer now ends with
  `(config: saved the key as provider kilocode)`.
- `install.ps1 -Dataset` — opt-in dataset capture at install time (the flag was documented nowhere and
  did not exist); without it the installer says the dataset stays off and how to turn it on.

### Verified
- `node --test test/*.test.js` → **87/87 pass** (kilo 8, readonly 6, i18n 3, dataset 10, selfconfig 8,
  config 10, router-moa 10, tools 7, re 8, agent 9, server 8, exe/build 0 skips), `npm run check` →
  **66/66 parse cleanly**, `npm run bench` → 7/7 **VERDICT: pass**, `node scripts/i18n-check.mjs` →
  **0 Swedish string literals**, `majin test` through the CLI → 87/87.
- Live against a faithful local Kilo stand-in (config written to a temp `MAJIN_HOME`, real `start`,
  real HTTP): `/api/provider {action:models}` → `5 models … saved in config`; `/api/chat` tool turn →
  route `kilocode/poolside/laguna-xs.2:free`, `fs.write` executed, file on disk, answer quoting the
  tool result; SSE turn → 15 `data:` events with route/step/tool/usage; usage `280/70` and
  `costUsd 0.00189` for a priced model, `tokensIn 280 · tokensOut 71 · costUsd 0.00189` in
  `usage.json`; wrong JWT → `401: invalid or missing API key` + `Wrong or deleted API key.`; the
  pasted key landed in `config.json` and appears in `trajectories.jsonl` as `my kilo key is <JWT>`
  with zero hits for the key itself; `/api/selftest full` → 10 rows, `✓ call
  kilocode/anthropic/claude-sonnet-4.5 — 2ms`.

### Not verified (still)
- **A real request to `api.kilo.ai` / `ai-gateway.kilo.ai`.** This sandbox has egress to github/npm/pypi
  only, so every attempt failed at connect (`SSL_ERROR_SYSCALL`, HTTP 000) while github returned 200.
  The provider is proven against the documented contract, not against Kilo's servers. Run on your own
  machine: `majin config set providers.kilocode.apiKey <jwt>` then `majin doctor --full` (or
  `curl -H "authorization: Bearer <jwt>" https://ai-gateway.kilo.ai/api/v1/models`).
- Windows `.exe` bytes, `install.ps1` (including the new `-Dataset`), and the browser rendering of the
  UI are still sandbox-unverifiable; nothing in the read-only or `re.spec` path needs them, but the
  `readOnly` toggle in the schedule card is not built yet (see TODO).

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
