# MAJIN V4 — vad som fungerar, vad som är blockerat

**Uppdaterad:** 2026-10-23 · **Commit:** se `git log -1` · **Branch:** `v4/main`

Det här dokumentet svarar på frågan *"körs det?"* — inte *"finns koden?"*. Allt som kräver Windows,
en telefon eller en provider-nyckel står som **BLOCKERAT** tills kommandot som bevisar det har körts.

## MAJIN är en universal agent, inte en jobbapp

Jobbsökningen är ett exempel och ligger kvar som en **skill** (data, inte appkod). Agenten själv är
verktygsagnostisk: den får en registry, en modell och en budget, och kombinerar verktyg för uppgifter
som ingen skill beskriver.

| Förmåga | Status | Bevis |
|---|---|---|
| Full inventering av V1–V4 | **klart** | `npm run v4:inventory` → `docs/v4/CAPABILITY_INVENTORY.{json,md}`; 26 V1-moduler, 139 verktyg (109 integrerade, 30 uteslutna med skriven anledning), 51 V2- och 4 V3-komponenter med beslut |
| Verktyg från V1 i V4 | **klart** | 19 lanes: files, shell, shelltools, sys, net, screen, web, research, jobs, flows, github, audit, learn, marketing, re, trading, power, desktop, computer |
| Verktygsupptäckt | **klart** | `tools_search` (deterministisk, ingen modell) + `tools_activate`; allt är nåbart även när listan kapas vid 64 |
| Multi-agent | **klart** | `agent_delegate`: egen kontext, egen verktygsdelmängd, max 5 rundor/6 anrop, ett steg djupt, egna V2-kvitton; verifierade filer lyfts till föräldramålet |
| Äkta end-to-end-bevis | **klart** | `universal-agent.test.js`: riktig OpenAI-kompatibel SSE-server → riktig V4-server → `tools_search` → `tools_activate` → `sys_info` → filskrivning → återläsning; mål COMPLETED med verifierat SHA-256 |
| Automatisk uppdatering | **byggd och testad** | signerad release över HTTP → `update.json`-kanal → apply → `node_modules` bevaras → logg; felaktig health check → automatisk rollback; avbruten uppdatering återställs vid nästa körning |
| Ett installationsflöde | **klart** | `npm run v4:setup -- --autostart --accept --release-url … --auto-update` |

## Fungerar och är testat i den här miljön (455 tester: 454 pass, 1 skipped)

Den enda skippade är `e2e.browser.test.js` — ingen webbläsarbinary finns i sandlådan.

| Område | Bevis |
|---|---|
| Parkoppling, sessioner, CSRF, rate limits, återkallning | `security.test.js` |
| Chatt med streaming, avbrott, återanslutning | `conversation.test.js`, `turns.test.js` |
| Mål, kvitton, verifiering mot disk (SHA-256) | `conversation.test.js`, `universal-agent.test.js` |
| Kraschåterhämtning till BLOCKED, resume mot inspelat hash | `crash.test.js`, `resume.test.js` |
| Kontextbudget | `context.test.js` |
| Minne läses in i prompten | `memory.test.js` |
| Verktygsfel klassas, begränsad återhämtning | `agent-failures.test.js`, `recovery.test.js` |
| Verktygsupptäckt: utanför listan → sök → aktivera → anropa | `tool-exposure.test.js`, `universal-agent.test.js` |
| Delegering till subagent med egen verktygsmängd | `universal-agent.test.js` |
| Owner Mode — behörighet från telefonen, omedelbar återkallning | `owner-mode.test.js` |
| Skills som data (job-search, fix-code) | `skills.test.js` |
| Filuppladdning, typkontroll, sandboxade förhandsvisningar | `uploads.test.js` |
| Riktig klientkörning i DOM | `client-dom.test.js` |
| MCP-klient: handskakning, verktygslista, anrop, env-scrub, döda servrar | `mcp.test.js` |
| Signerad release, hash-före-skrivning, overlay, rollback, recovery | `updater.test.js`, `update-auto.test.js`, `release-flow.test.js` |
| Windows-installern (strukturellt: task-inställningar, batteri, uppdateringstask) | `windows-installer.test.js` |
| Backup/restore, uppgradering, supervisor | `backup.test.js`, `upgrade-git.test.js`, `supervisor.test.js` |
| Telemetri utan meddelandeinnehåll | `telemetry.test.js` |

## BLOCKERAT — kräver din maskin

| Påstående | Varför det inte är bevisat | Kommandot som bevisar det |
|---|---|---|
| Windows-verktyg utförs (`control.type`, `control.list_windows`, `computer.use`) | kräver Windows + interaktiv session | `npm run v4:tools -- --probe` |
| PowerShell/`exec.*`/`shell.*` kör kommandon | kräver din maskin | samma |
| Edge/webbläsare styr sidor | kräver webbläsare + Playwright | `npm run v4:e2e` |
| Riktig inferens via din provider | ingen nyckel i den här miljön | `npm run v4:accept` |
| iPhone/Android över tunnel | ingen telefon, ingen tunnel | `npm run v4:accept -- --url https://…` |
| Windows Task Scheduler kör uppdateringstasken | kräver Windows | `npm run v4:setup -- --auto-update` och läs `%LOCALAPPDATA%\MAJIN\v4\logs\update.log` |
| OCR av skannade PDF:er | medvetet inte byggt | en skannad PDF ger `NO_TEXT_LAYER` |

## Inte byggt alls (och varför)

1. **CUA som medföljande server.** MCP-klienten finns; en CUA-server är tredjepartsprogram som du
   installerar och pekar ut i `v4/mcp.json`.
2. **OCR.** MAJIN säger `NO_TEXT_LAYER` i stället för att gissa.
3. **V1:s `agent.delegate`/`teams`/`majin.*`.** De kör V1:s egen loop, guard och config. Att koppla
   in dem hade gett två agent-runtimes och två sanningar; V4 har egna motsvarigheter
   (`agent_delegate`, `tools_search`, setup/doctor/owner-mode). Se `SOURCE_AUDIT.md` §5.

## Ett kommando — install + acceptans

```powershell
cd C:\MAJINCLI
git pull
npm ci
npm run v4:setup -- --autostart --accept --release-url https://<release-base> --auto-update
```

Det gör allt som går att göra utan dig: parkod (visas en gång), Owner Mode-seed, release-nyckel,
uppdateringskanal, inloggningstask, uppdateringstask och acceptanskörning med skriven bevisfil.
Det som återstår är det bara du kan: skapa tunneln och lägga in provider-nyckeln.

Skicka utskriften från:

```powershell
npm run v4:tools -- --probe
npm run v4:accept -- --url https://<din-adress> --write
```

Då flyttas raderna ovan från BLOCKERAT till bevisat — eller så lagas det som visar sig vara trasigt.
