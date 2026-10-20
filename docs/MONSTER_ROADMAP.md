# MONSTER ROADMAP — "Allt de kan. Plus det ingen kan."

Princip: **UI/UX är perfekt och rörs aldrig.** Allt byggs under huven (core/tools/channels/backends).
Varje våg = 1 leverans: kod + `node --test`-svit + evidence-JSON under `docs/evidence/`, samma
gate-kultur som completion matrix: inget räknas som klart utan test som var rött före, grönt efter.
Noll nya npm-dependencies där det går (MAJIN vendorear allt — cron-parsaren och mini-YARA är mönstret).

## Vågöversikt (körordning, varje våg beroende av föregående)

| Våg | Funktion | Dödar | Storlek |
|-----|----------|-------|---------|
| W1 | **Absorb Core** — `majin absorb <github-repo>` | *det unika* (se nedan) | S |
| W2 | **Research Engine** — multi-query research med citation-ledger | Perplexity Computer | S |
| W3 | **Execution Backends** — host / docker / ssh isolerade körningar | Grok Bot, Hermes-backends | M |
| W4 | **Standing Teams** — persistenta roller + delat team-minne | CellCog | S |
| W5 | **Event Flows** — "när X händer → gör Y", triggers: schedule/file/webhook/email-poll | Lindy | S |
| W6 | **Power Transfer** — absorberade capabilities → test-gated skill/tool-förslag | *det unika, del 2* | M |
| W7 | **Manus Loop** — mål in → verifierad artefakt ut (execute→verify→repair) | Manus | S |
| W8 | **Channel Expansion** — Matrix (ren HTTP), Discord/Slack (REST-polling), Email | OpenClaw-lyftet | M |
| W9 | **Memory Sync** — git-baserad sync av `~/.majin` mellan enheter (opt-in) | Vellum | S |
| W10 | **Learning Loop 2.0** — bakgrunds-review var N:e tur, skill-förbättringsförslag | Hermes självlärande | S |

---

## W1 — Absorb Core 🐲 (det ingen annan har)

Majin Buu absorberar motståndare och tar deras krafter. MAJIN har världens enda
reverse engineering-stack i en agent (22 `re.*`-tools). Absorb gör det mot agent-repos:

- `majin absorb NousResearch/hermes-agent` → klonar till tmp (systemets `git`, ingen dep)
- Kod-karta: JS/TS/Python/Go — entrypoints, modulträd, exports (bygg på konventionerna i `scripts/parse-all.js`)
- Capability-extraktor (heuristik, inga LLM-antaganden): hittar *kanal-adapters, tool-register,
  minnessystem, scheduler, backends, skills* och klassar dem på MAJIN:s egen taxonomi
- Utdata: `~/.majin/absorbed/<namn>/capabilities.json` + läsbar `absorb-report.md`
- DoD: 3 offline fixture-repos i test; äter MAJINCLI själv och hittar sin egen verktygskatalog ≥ 95 %
- Filer: `src/core/absorb.js`, `src/core/tools/absorb.js`, `test/absorb.test.js`

## W2 — Research Engine

- `research.*`-tools: plan → multi-query `web.search` → `web.fetch` → extraktion → syntes
- **Citation-ledger**: varje påstående i rapporten måste ha källa + exakt citat; påstående utan källa
  märks automatiskt `[okällat]` — aldrig tyst hallucination
- Artefakt: `~/.majin/reports/<id>.md` (bara filer, UI orörs)
- DoD: offline-fixtures + demo-provider; rapport om 3 källor ger 100 % citat-täckning eller ärlig flagg

## W3 — Execution Backends

- `src/core/backends/`: `host` (dagens beteende), `docker` (via `docker`-CLI), `ssh` (via `ssh`-CLI)
- Per-uppdrag isolering: kör shell/RE/web-jobb i bur, returnera artefakter + logg
- Ärliga fel: docker saknas → en mening + nästa handling (samma stil som nyckel-felen i README)
- `config.backends.default`, per-mission override
- DoD: docker-backend testas i CI (docker finns på runners), ssh mockas deterministiskt

## W4 — Standing Teams

- Persistenta agenter: `~/.majin/agents/<roll>.json` (persona-rad, roll, minnes-namespace, heartbeat-jobb)
- Swarm-dispatch på roll istället för ad-hoc workers; delat team-minne via befintlig `memory.js`
- "Anställ en researcher och en kodare" i chat → roller sparas, överlever omstart
- DoD: team-test: 2 roller delar minne, isolerade från andra team; restart överlever

## W5 — Event Flows

- Triggers: schedule (finns) + fil-watch + webhook (ny route i `src/core/routes.js`) + email-poll (valfri)
- "När X händer → gör Y" på naturligt språk → `flows.json` (ingen kod, som Lindy)
- Runner med per-körning-logg; misslyckande = ärlig status, inga tysta retries
- DoD: flow-test: webhook triggas, task körs, logg skapas; 3 trigger-typer gröna

## W6 — Power Transfer (Absorb del 2)

- `capabilities.json` → konkreta förslag: nya `src/core/tools/absorbed/<x>.js` + SKILL.md
- **Gate-kedja**: förslag → `parse-all` → adversarial-svit → full test → sedan *förslag* till ägaren i chat
  (selfconfig-stilen: MAJIN patchar aldrig sig själv live utan godkännande)
- DoD: absorb av ett fixture-repo producerar ett kompilerande, testgrönt tool-förslag

## W7 — Manus Loop

- Bygg vidare på `mission.js` (verify-repair step 1 finns): mål → plan → execute → **verify mot
  artefakt-kontrakt** (fil finns, tester passerar, rapportsektioner fyllda) → repair (max N varv, ärligt block)
- "Gör en marknadsrapport om X" → verifierad fil levererad, inte bara svar
- DoD: e2e real-workflow-judge grön mot artefakt-kontrakt; evidence-JSON

## W8 — Channel Expansion

- Nya adapters i `src/core/channels/` (samma gränssnitt som telegram.js):
  - **Matrix** — ren HTTP sync-API (noll dep)
  - **Discord** — REST-polling + posting (noll dep)
  - **Slack** — REST-polling (`conversations.history`) (noll dep)
  - **Email** — imap-poll/smtp via befintliga net-tools
- Heartbeat-profil per kanal (intervallet från schedule.js)
- DoD: mock-servrar i test; äkta token endast i `.live.test.js` (samma mönster som browser.live.test.js)

## W9 — Memory Sync

- Sync av `~/.majin` (minne, agenter, flows — aldrig nycklar) via git mot ägarens privata repo
- Opt-in, av som standard; konflikt = journal-merge (nyast vinner, båda sparas)
- Censurlinje enligt `docs/DATA.md` — inget som flaggats privat lämnar maskinen
- DoD: sync-test med lokal bare remote; nyckel-filer verifierat exkluderade

## W10 — Learning Loop 2.0

- Efter N turer: bakgrunds-review av sessionen → skill-harvest (finns delvis) →
  **förbättringsförslag** på befintliga skills, test-gated, ägar-godkänt via selfconfig-spåret
- Bygger på w7-skill-telemetry som redan är shipped
- DoD: skills-failures.test + ny w13-learning.test grön

---

## Regler för alla vågor

1. UI/UX (`src/ui/`) rörs **aldrig**.
2. Varje våg slutar med: `npm run check` (parse-all), `node --test test/*.test.js` grön,
   evidence-fil, CHANGELOG-rad.
3. Noll nya runtime-dependencies utan ägar-godkännande.
4. Ärliga fel > tysta fallbacks. Alltid.
5. En våg per leverans. Ingen hopping.
