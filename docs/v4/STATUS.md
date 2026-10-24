# MAJIN V4 — vad som fungerar, vad som är blockerat

**Uppdaterad:** 2026-10-23 · **Commit:** se `git log -1` · **Branch:** `v4/main`

Det här dokumentet svarar på frågan *"körs det?"* — inte *"finns koden?"*. Allt som kräver Windows,
en telefon eller en provider-nyckel står som **BLOCKERAT** tills kommandot som bevisar det har körts.

## 2026-10-23 — filåtkomst, delad historik och chatt­hantering

Den här omgången svarar på de tre sakerna du rapporterade från Windows och iPhone. Allt nedan är
kört i den här miljön; det som kräver din maskin står kvar under **BLOCKERAT**.

### 1. Filåtkomst: godkända mappar fungerar nu på riktigt

Felet var inte en saknad fil utan att **Owner Mode registrerade mappar som ingen verkade läsa**:

| Före | Efter |
|---|---|
| `allowsPath()` fanns men anropades aldrig | `src/v4/path-access.js` verkställer på varje anrop |
| `fs.*` fick vilken absolut sökväg som helst | en sökväg måste ligga i arbetsytan eller en godkänd mapp |
| modellen fick aldrig veta vilka mappar som var godkända | systemprompten listar dem, med instruktionen att söka där |
| ingen kunde söka upp en fil på namn | nytt återanvänt V1-verktyg `fs.find` (namn/glob, bounded) |
| `document_read` läste bara arbetsytan | läser nu även `path` i en godkänd mapp, via samma extraktor |

Verifierat med riktiga filer (`test/v4/file-access.test.js`): `fs_find` hittar `CV Anders 2026.pdf`
i en godkänd mapp, `document_read` läser texten ur PDF:en, allt utanför nekas med
`PERMISSION_DENIED`, `..`-traversering nekas, och en återkallad mapp är stängd på nästa anrop.
Symlänkar avgörs på sitt verkliga mål.

### 2. Delad historik mellan enheter

Samma V4-lagring, inget nytt chattsystem:

- `GET /api/conversations?view=active|archived|all&q=…&since=…` — sökning i hela transkriptet,
  arkivvy och en tidsmarkör så en andra enhet bara hämtar det som ändrats.
- `PATCH /api/conversations` — byt namn (manuellt namn vinner för alltid) och arkivera/återställ.
- `DELETE …&confirm=1` — bekräftelse krävs; kör en uppgift fortfarande svarar servern `409`,
  och `&cancel=1` stoppar den först.
- Tombstones (`conversations-deleted.json`) — en radering på telefonen återuppstår inte på datorn.
- Klienten pollar var 6:e sekund när fliken är synlig och hämtar om den öppna konversationen när
  dess `version` ändrats. Enheten minns vilket samtal som var öppet och öppnar det igen efter omstart.
- Import av V1-historik (`POST /api/conversations/import`, torrkörning först): läser
  `<MAJIN_HOME>/sessions/*.jsonl` + `chats-index.json`, bevarar titel/arkivstatus, hoppar över
  system- och verktygsrader, rör aldrig källfilerna och är idempotent (en växande V1-logg fylls på,
  den dupliceras inte). V2 och V3 hade ingen bestående chattlogg — det står i svaret.

### 3. UI/UX

- **En enda centrerad kolumn** (`--content-w: 820px`) för topbar, hero/spirit, transkript,
  composer och godkännandekort. Den gamla mixen 900/780 px är borta, och `100vh` är ersatt av
  `100dvh` så iOS-tangentbordet inte knuffar layouten.
- **Historikpanel** som drawer (stängd som standard, öppnas från topbaren eller med swipe från
  vänsterkanten), med sökfält, flikarna Aktiva/Arkiverade, aktiv markering och en `⋯`-meny per rad:
  Byt namn, Arkivera/Återställ, Radera permanent.
- **Bekräftelsedialog** för radering, skild från arkivering, med texten att radering gäller alla enheter.
- **Nytt samtal** skapar ett tomt samtal med hero och bokmärker det inte.

### Tester

`479 tester, 478 pass, 0 fail, 1 skipped` (webbläsarbinary saknas) samt nya:
`history-sync.test.js` (10), `file-access.test.js` (7), fyra nya DOM-tester i `client-dom.test.js`
och tre layoutkontrakt i `ui.test.js`.

Acceptanskörningen (`npm run v4:accept`) visar nu filåtkomsten själv, med en riktig fil i en mapp
utanför arbetsytan: `files.folder_grant` (godkänn via HTTP-API:t), `files.fs_find_registered`,
`files.search_granted_folder` (hittar `acceptans-cv.docx`) och `files.refuses_ungranted`
(`PERMISSION_DENIED` för en mapp som inte är godkänd). Enda kvarvarande FAIL i den här miljön är
`model.configured`, eftersom ingen provider-nyckel finns här.

## 2026-10-23 — multiagent: V1:s team och V2:s scheduler är nu riktigt återanvända

Arkitektens invändning var korrekt: V4 hade ersatt V1:s bestående team och V2:s DAG med en
två-nivå-delegering, och inventeringen räknade bara **verktygs-lanes**, vilket gjorde återanvändning
av motorer osynlig. Det är åtgärdat genom att återanvända motorerna, inte genom att skriva kopior.

| Förmåga | Före | Nu |
|---|---|---|
| Bestående team (roll, instruktioner, verktygslista per medlem) | fanns bara i V1 | `team_manage` ovanpå V1:s `TeamStore` (roster.json + memory.jsonl) |
| Teamkörning med DAG, kritisk väg, omförsök, blockerade efterföljare | fanns bara i V1 | `team_run` ovanpå V1:s `runTeam` + `runSwarm` — oförändrade |
| Checkpoint och återupptagning utan omkörning | fanns bara i V1 | samma `runTeam`; bevisat att `resumeId` hoppar över klara noder |
| Beroendegraf med parallella steg | fanns bara i V2 | `agent_graph` ovanpå V2:s `TaskGraph` + `runGraph` |
| Kvitton per delsteg | — | V2:s `runGraph` skriver dem på ett eget mål; verifierade filer lyfts till föräldramålet |

Hur det hänger ihop: `runTeam` hade redan en **`makeWorker`-krok**. V4 skickar in en worker byggd på
`runSubtask`, så en teammedlem är en avgränsad V4-subagent med persistent identitet — V4:s modell,
registry, godkännandepolicy och kvitton. Ingen andra agent-runtime, ingen V1-fil ändrad.

**Bugg hittad i den återanvända budgetlogiken:** `teamStepCap` kontrollerades vid lansering, så två
noder som startade i samma tick båda passerade kontrollen. Uppmätt: `cap: 1`, `spent: 2`,
`status: complete`. V4:s worker reserverar nu värsta fallet före första `await`, så summan av
pågående reservationer aldrig kan överstiga taket. V1:s kontroll finns kvar som yttre skydd.

`agent_delegate` finns kvar för enstaka subuppgifter; `agent_graph` och `team_run` är för arbete med
riktiga beroenden. Alla tre följer `agent`-lanen och försvinner direkt vid återkallning.

### Vad som fortfarande inte är likvärdigt

- **V2:s orchestrator, compiler och supervisor.** De planerar och verifierar åt V2:s egen loop, som
  V4 inte kör. `agent_graph` täcker det som spelar roll för användaren (parallellt, beroenden,
  blockerade efterföljare, kvitton). Att importera en andra planerare hade gett två sanningar om
  vad uppgiften är.
- **Röst och Windows/mobil-verifiering.** Koden finns och är testad; riktig enhetsverifiering kan
  inte göras härifrån och står kvar som BLOCKERAT.

## 2026-10-24 — MAJIN lär sig av verifierat arbete

Ägaren ska lära MAJIN genom att ge **mål**, inte genom att skriva nya masterprompts. Det kräver att en
verifierad körning kan bli en återanvändbar procedur — och att en overifierad aldrig kan låtsas vara det.

Byggt i `src/v4/learning.js`, inkopplat i befintlig agent, befintlig skill-laddare och befintligt minne.
Ingen andra motor, inget andra lager.

| Krav | Hur det är löst |
|---|---|
| Extrahera bara det som bevisats | endast mål som nått `COMPLETED` **och** har ett oberoende verifierat kvitto; modellens eget påstående är aldrig bevis |
| Inga hemligheter, personuppgifter eller sköra selektorer | proceduren sparar **verktygsnamn och argumentnamn**, aldrig värden; nycklar, sökvägar, e-post och CSS-selektorer strippas före skrivning |
| Får aldrig utöka behörighet | `requires` = snittet av beviljade lanes och de lanes som faktiskt användes |
| Tillstånd | EXPERIMENTAL → VERIFIED → REUSABLE, `STALE` när miljöns fingeravtryck ändras, `FAILED` när fel överväger. Ingen tyst befordran |
| Återanvändning | relevansrankad hämtning, så en **besläktad men ändrad** uppgift hittar proceduren; prompten anger tillitsnivå och "upprepa inte"-listan |
| Inte upprepa misslyckat | en inspelad misslyckad strategi nekas med förklaring (`LEARNED_AVOID`) i stället för att köras igen |
| Insyn | `GET /api/learning` visar tillstånd, konfidens, bevis och undvik-listan; panelen **Inlärt** i appen |

Bevisat här (`test/v4/learning.test.js`, 15 tester): sanitering, att extrahering nekas utan verifiering,
att bara argumentnamn lagras, befordran, diagnos, hämtning, **hela A–H-flödet med en riktig omstart**,
avoid-guarden, STALE vid miljöbyte, och att ett inlärt recept inte kan kräva en icke-beviljad lane.

**Det som återstår är ett enda steg: den riktiga Go-körningen.** Den kan inte göras härifrån (ingen
provider-nyckel), så den står kvar som oavklarad:

```powershell
npm run v4:learn-accept
```

Skriptet vägrar köra i demo-läge och skriver bevisen till `docs/v4/evidence/learned-skills-*.json`.

## 2026-10-24 (forts.) — självförbättring: det som saknades

Frågan var om det finns färdiga GitHub-repos att återanvända. **Svar: nej, inget
som går att droppa in.** Fem kontrollerades via GitHub API:

| Repo | Språk | Licens | Bedömning |
|---|---|---|---|
| `zorazrw/agent-workflow-memory` (AWM) | Python | Apache-2.0 | design återanvänd |
| `LeapLabTHU/ExpeL` | Python | Apache-2.0 | design återanvänd |
| `zjunlp/SkillAdaptor` | Python | MIT | design återanvänd |
| `MineDojo/Voyager` | JavaScript | MIT | **avvisad** — JavaScriptet är ett Minecraft-bibliotek (mineflayer) |
| `OpenLAIR/OpenSkill` | PDDL | Apache-2.0 | **avvisad** — "code coming soon", inget körbart |

Alla är Python-forskningskod bundna till sin egen benchmark (mind2web, WebShop,
ALFWorld, Minecraft). Att bak:a in en hade gett en andra agent-motor — precis det
integrationsregeln förbjuder. Det som återanvänts är **designen**, implementerad
mot MAJIN:s eget lager:

| Idé | Källa | Nu i |
|---|---|---|
| Parameterplatser så en procedur tjänar många uppgifter | AWM | `induceSlots`, `renderProcedure`, visas i prompten |
| Attribuera felet till **ett** steg och revidera bara det | SkillAdaptor | `attributeFailure`, `observeFailure` |
| Jämför successtransaktion mot misslyckad, inte en i taget | ExpeL | `contrastiveInsight` |
| Integritetshash så en redigering utanför systemet syns | skill-provenance | `skillIntegrity` |

**Och en bugg i vår egen motor:** `penalise()` fanns men **anropades aldrig**. Ett
misslyckat varv som använt en inlärd skill lämnade alltså inget spår — en procedur
som gått sönder av en ändrad miljö hade fortsatt se frisk ut för alltid. Nu stängs
loopen: felet attribueras till ett steg, och skillen blir `STALE` först när samma
steg fallerar upprepat. Bevisat i `test/v4/learning.test.js` (17 tester), inklusive
en riktig omstart mellan de två misslyckade varven.

## 2026-10-24 (forts. 2) — bundna försök, kostnadsmätning och ett knapptryck för Go-körningen

Tre saker som specifikt saknades är nu byggda:

**1. Inga identiska misslyckade anrop två gånger.** Specen kräver bundna försök och
"never run unlimited retries". Guarden jämför en hash av verktyg + argumentvärden
(hashen lagras aldrig) och nekar en upprepning av exakt samma anrop som redan
misslyckats med en icke-övergående klass. Övergående fel (TIMEOUT, NETWORK_FAILURE,
rate limit) får fortfarande köras om — det var aldrig verktyget det var fel på.
Bevisat i `test/v4/no-progress.test.js` (3 tester).

**2. Läsningar verifieras nu oberoende.** Tidigare verifierades bara skrivningar, så
en ren läsuppgift blev aldrig "independently verified" — och kunde därför aldrig
godkännas av inlärningsgrinden. Nu stat:as filen om efter att verktyget läst den och
storleken jämförs med vad verktyget rapporterade.

**3. Kostnaden mäts.** Token räknas från providerns eget `usage`-fält och prissätts
med publicerad taxa; okända modeller rapporteras som `null` i stället för en påhittad
siffra. Den simulerade körningen: **4 modellanrop, 4800 in / 720 ut, $0,00108**.

### Go-körningen behöver ingen inklistrad nyckel längre

Repot har redan en `OPENCODE_API_KEY`-secret. Nytt arbetsflöde kör grinden med den:

```
gh workflow run v4-learn-accept.yml --ref v4/main
```

Det vägrar passera utan nyckel (saknad secret är hårt fel, inte grön körning), är
bundet till ett fåtal billiga anrop och laddar upp bevisfilen som artifact. Nyckeln
skrivs aldrig ut.

### Status på A–H

Med en simulerad OpenCode Go-endpoint (samma trådformat): **14/14**. Hela kedjan
A→H, inklusive riktig processomstart, hämtning och att det misslyckade anropet inte
upprepas. Kvar: samma körning mot **riktig** Go-inferens.

## 2026-10-24 (forts. 3) — A–H GRÖNT MED RIKTIG OPENCODE GO

Den obligatoriska grinden är körd mot **riktig** provider (glm-5.3-flash via
OpenCode Go), i GitHub Actions med repots befintliga `OPENCODE_API_KEY`. Ingen
nyckel har klistrats in, skrivits ut eller lagrats.

```
PASS  turn.A.failed_first_attempt    a real failure was observed
PASS  turn.A.independent_verification at least one receipt was verified
PASS  D.skill_stored                 learn-files-955cc0
PASS  turn.A.cost                    4 model call(s), 16796 in / 309 out, $0.002674
PASS  E.skill_survives_restart       1 learned skill(s) after restart
PASS  G.skill_retrieved              the learned section and the skill name reached the prompt
PASS  H.failed_strategy_not_repeated the failed action was not executed again
14/14 checks passed
```

Vad som hände på riktigt: uppgiften angav `CV Anders 2026.txt`, filen på disk heter
`CV_Anders_2026.txt`. Modellen försökte den angivna sökvägen, fick ett **äkta**
`not found` (A), bytte strategi till `fs_find` (B), läste filen med verifierat
kvitto (C), och en skill sparades (D). Värden startades om (E), en besläktad uppgift
gavs (F), den inlärda sektionen och skill-namnet fanns **i den faktiska prompten**
(G, direkt bevis i stället för en proxy), och det misslyckade anropet upprepades
inte (H). Kostnad för hela grinden: **$0,002674**.

### Buggen som bara en riktig modell kunde avslöja

`extractCandidate` markerade en handling som "övergiven" så snart mer än ett verktyg
hade lyckats — även när samma verktyg senare lyckades i samma körning. Med den
riktiga modellen innebar det att `fs_read` hamnade i "upprepa inte"-listan efter att
ha misslyckats en gång på en fel sökväg och sedan lyckats på rätt. Skillen avrådde
alltså från det korrekta steget. Rättat: en handling är övergiven bara när den
aldrig lyckades senare i körningen och arbetet flyttade till ett annat verktyg.

### Vad det inte bevisar

En smal uppgift, en modell, en miljö. Enligt specen är en enstaka framgång
EXPERIMENTAL — bredare tillförlitlighet kräver upprepade verifierade körningar över
varierade uppgifter, och det är precis vad befordringsreglerna kräver. Det säger
inget om Windows-värden, telefonen eller browser-lanen.

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
