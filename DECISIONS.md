# Decisions

Why MAJIN is built the way it is. One entry per decision: **what we chose — why — what it cost —
how it is proven**. This file exists so nobody re-argues these in a code review six months from
now; if you change one, change the entry here in the same commit.

## Product

**A normal person has to be able to use it.** Not a developer with a terminal: pick the provider,
paste the key, get going. Everything else — the 77 tools, the model chain, the schedule — is a
bonus that must never be *required* to get the first answer. — Why: the brief is one person on a
Windows laptop who has never opened PowerShell. — Cost: no CLI-only features allowed, so every
capability needs a tool *and* a panel surface, which is why half the fixes land in `src/ui`. —
Proof: `test/onboarding.test.js` starts from an empty data home and asserts the first message is
answered in under 15 s; today it is 127 ms.

**A few things fully, rather than many halfway.** MAJIN's promise is: it answers, it touches the
machine, it remembers, it can be reached from a phone. Reverse engineering, dataset capture and the
scheduler exist, but none of them is allowed to make the four promises worse. — Proof: `npm run
bench` (7 scripted scenarios, verdict pass) and the suite of 97 tests, both run against the same
code path a browser uses.

**The browser tab is the product; the CLI is only a door opener.** `majin start|window|doctor|
status|url|logs|config|pair|send|test`. Schedules, memory, skills, channels, dataset and RE work are
instructed in chat or in the panel. — Why: an icon that opens a window is a thing a normal person
can use; a command they must remember is not. — Cost: `POST /api/*` routes must stay in sync with
the tools. — Proof: UI routes **delegate to the tool** (`/api/provider` runs `majin.provider`), and
the onboarding tests drive the HTTP endpoints the panel uses, not internal functions.

**Measure, then fix what the measurement showed.** Every fix in this repo starts from a number taken
from a real run against a fresh home (`MAJIN_HOME` in a temp dir, a local stand-in provider that counts
requests), never from reading code and guessing. — Proof this round: a rejected key burned four steps
and four gateway calls and printed the retry count in the user's face (`Provider error after 4
failures: 401: invalid or missing API key`); the first message on a virgin install leaked
`EVIDENCE FROM THIS TURN` and `ANSWERS FROM 3 REFERENCES` as its answer; `save` with an empty box said
"provider saved"; `kilocode` and `nous` were unreachable from the browser because the dropdown was a
hardcoded list of 9.

**Write the failing test before the fix, ≤5 files per fix.** The onboarding tests were committed in
a red state (10 failures, each with the measured string in the assertion message) and only then made
green; each of the three fixes below touches 3–4 files. When a fix wants more files, the scope is
wrong, not the test.

## Failure wording

**One sentence, one place.** `explainError(err, route)` in `src/core/provider/chat.js` classifies
every provider failure into `no_key | auth | billing | model | toobig | rate | unreachable |
upstream | provider` and returns the sentence the user reads, plus `retryable` and `needsKey`. No
caller writes its own apology. — Why: the same failure reaches a chat answer, an SSE `error` event,
a toast and a `doctor` row; four phrasings of one truth is how products start to feel sloppy. —
Cost: `errorKind`/`errorHint` had to be threaded through `loop.js` → `agent.js` → `/api/chat`, three
extra fields on the result. — Proof: `test/onboarding.test.js` pins each kind's sentence and forbids
the old shapes (`Provider error after`, `fetch failed`, `TypeError`).

**A permanent failure must not be retried.** 401/402/403/404, a missing key and an over-long
context stop the turn on the first attempt (`stop`), while 429/5xx and network errors keep the
existing backoff. — Why: four calls to a door that will not open is not resilience, it is a slow
error message and spent quota. — Proof: the stand-in provider counts hits; the test asserts
`hits === 1` and `steps === 1`, and the whole turn under 5 s.

**Never show the user the machinery.** `Provider error after N failures`, `EVIDENCE FROM THIS
TURN`, `ANSWERS FROM 3 REFERENCES`, `Demo answer (mock):`, `QUESTION:` are all banned in assertions.
The demo answer is now a sentence a person reads once and knows what to click.

## Setup

**The UI never hardcodes a provider list.** `GET /api/state` carries `presets` (`presetCard()` in
`presets.js`). — Why: a list copied into `panels.js` rots silently; two presets were already
unreachable. — Proof: the state test asserts every preset is present, with exactly the keys the card
needs.

**An empty box is not a save.** `needsKeyFor()` is the one rule (mock/demo no key, `ollama` and
`lmstudio` ship a dummy, loopback and RFC1918 addresses are yours), used by both
`majin.provider add` and `POST /api/provider`. Refusal writes nothing. — Why: a fake "saved" costs a
beginner an evening of thinking they are broken. — Cost: a local OpenAI-compatible server on another
LAN host with no auth has to type something in the key box — accepted, since guessing "no key needed"
for arbitrary addresses is how you end up silently storing garbage.

**Your own endpoint belongs in the card, not in a config file.** The address box next to the key
covers Ollama/LM Studio/a box on the network; `POST /api/provider` writes it and the state card shows
it back. — Proof: the HTTP test reads `config.json` from disk after the save (so a restart keeps it)
and re-reads `/api/state`.

**No model chain while the setup is unfinished.** `needsSetup` turns MOA off for the turn
(`moa.skipped: 'setup'`). — Why: three references plus an aggregator against a mock is five
echoes of the same string, and the aggregate text was landing in a first-time user's answer. — Cost:
`test/agent.test.js` now seeds a dummy key so the MOA path stays covered; the fresh-install test
asserts no `moa:*` events at all.

## Language

**Shipped strings in English, comments and docs in Swedish.** Anything the user, the model or a log
line can see is English; the code that explains itself to the owner stays Swedish. Swedish survives
only where it *matches* input (route words, job words, weekday names, the `/ja`·`/nej` channel
commands). — Proof: `npm run i18n` (0 hits in 57 files) plus `test/i18n.test.js`, which also asserts
the deliberate matchers are still there. Widening the detector's word list this round
(`Notera Testa Kvar ange svara bort`) immediately found a dozen strings the old list had walked
past — a Swedish approval prompt sent to Telegram and WhatsApp users, Swedish in tool results the
model quotes back, and Swedish in `install.ps1`, which is the first thing a Windows user reads.
A gate is only as good as its word list.

## Deliberately not done (not forgotten)

- **Browser rendering.** `src/ui/*` has never been opened in a browser by anyone in this sandbox.
  The new picker, address box and error toasts are verified by source assertions and HTTP contract
  tests only. The card needs one human click-through before the sentence "just paste your key" is
  honest.
- **Windows.** `majin-win-x64.exe`, `install.ps1` and the scheduled task are built and reviewed here
  but never run on Windows (no wine/mingw, `pkg-fetch` has no `node20-win-*`); `dist/majin.cjs` is
  rebuilt and re-checked before any claim, and every claim says "packaged build, Linux".
- **Live provider, live Telegram/WhatsApp.** No egress to `*.deepseek.com`, `*.kilo.ai` or
  `api.telegram.org` from here; the wire shape is verified against local stand-ins and the user gets
  the one command that proves it for real.
- **No provider-key encryption at rest, one token for the whole machine, no per-user auth.** The
  config file is the vault; the token is the door. MAJIN is a personal agent on a personal machine.
  The server binds `0.0.0.0` on purpose so a phone can reach it to pair, but `allowRemote:false`
  means anything from outside loopback must carry the token, and `trustLocal:true` is only what lets
  the local window in without one. Revisit before it ever faces a network.
- **No database.** JSONL and small JSON files in the data home, append-only where it matters
  (`usage.json`, the dataset). — Why: `majin` must be copyable by hand and greppable when it misbehave.
- **Cost truth is partial by design.** Only DeepSeek has `pricing` entries; everything else reports
  $0 with the TODO item open, rather than a table of guessed prices.

## 2026-06-18
- **Update repo migration in repoSlug (not a config migration pass):** the check
  path is the only reader of updates.repo, so fixing it there covers CLI, server
  and UI at once without a versioned config-migration framework we do not have.
- **Rejected: auto-creating a desktop shortcut from the running app.** Would
  bypass the user's installer choice and needs registry-free .lnk writing from
  Node; UsePreviousTasks=no + unconditional Start Menu entry achieves the
  guarantee inside Inno, the tool that owns shortcuts.

## 2026-06-18 (kväll) — Imagination Engine slice 1
- **imagine.js as a side-loaded module feeding off onEvent(), not a rewrite:**
  the SSE stream already funnels through onEvent(); one guarded line hands the
  same real events to the canvas. Deleting imagine.js breaks nothing (guards
  are asserted in test).
- **Native <details> for step payloads:** keyboard-accessible, zero JS,
  textContent only (spec: the LLM never injects markup).
- **CSS-only core animation:** GPU-cheap, reduced-motion media query stops the
  pulse with no JS state; energy requirement of the spec met by construction.
- **Skipped for now:** WebGL/Canvas orb (violates the energy rule for v1),
  fake "thinking" shimmer (spec forbids fabricated activity).
