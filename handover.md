# MAJIN handover — löpande funktionstest

Senast uppdaterad: 2026-10-19. Status: pågående audit efter v0.9.0.

## Var arbetet finns
- Repository: rssen-debug/MAJINCLI, lokal checkout i work/MAJINCLI under denna chats arbetsmapp.
- Senast levererat: v0.9.0, main 416132ff2780eddf57bd17d2f9c1d8395bcf7304, PR #58.
- Kanonisk arbetslogg: handover.md i repositoryts rot. En löpande kopia finns i chats outputs/handover.md.

## Uppdrag och begränsningar
Gå igenom appen på Windows, åtgärda fel, testa OpenCode endast med verifierat kostnadsfria modeller, committa/pusha/merga verifierade ändringar. Använd isolerad testdata. Inga nycklar i kod, loggar eller dokument. Inga betalda modellförsök eller betald fallback. Externa meddelanden och ägarens produktionsdata ingår inte i automatiska skrivtester.

## Redan verifierat i tidigare leverans
- v0.9.0: CI 408 tester, 394 godkända, 14 avsiktligt överhoppade, inga fel.
- Windows installer/exe: CI installation, omstart, avinstallation med bevarad data, återinstallation godkända.
- Edge UI: modellfilter, pagination, tangentbord, mobil layout, aktivitetsstatus, preview/download, demo-chat och stopp testade.
- Dessa resultat är från föregående leverans; aktuell bred audit återstår.

## Kända observationer som måste följas upp
| ID | Observation | Status / nästa steg |
|---|---|---|
| API-01 | Tidigare OpenCode Zen-anrop gav HTTP 403; Go-anrop gav timeout. Ingen lyckad extern inferens verifierad. | Läs säkert felmeddelande och aktuell officiell API-dokumentation. Fastställ gratis modell och korrekt endpoint före nytt försök. |
| MODEL-01 | Historiska preset-modeller kan vara inaktuella; live modellväljaren finns. | Granska presets och felåterhämtning. |
| TEST-01 | Tidigare lokal Windows helsvit hade plattformsberoende assertions. | Kör aktuell svit, registrera exakta fel och åtgärda relevanta fel. |

## Testjournal
1. Audit startad. Checkout main v0.9.0 är ren. Denna handover skapad före nya kodändringar.

## Otestat / kvar
Aktuell full testsvit, bred API/UI-inventering, säker OpenCode-diagnostik, fixes med regressionstester, visuell kontroll vid UI-ändring, PR/CI/merge. Funktioner som kräver externa konton eller verkliga systemintegrationer måste redovisas separat om de inte kan verifieras.

### Checkpoint 2 — första aktuella Windows-körningen
408 tester: 385 godkända, 9 fel, 14 överhoppade (27,7 s). Felidentifierare:
- WIN-01: mission.verifyContract använder hårdkodad /bin/sh; command_exits_zero fungerar därför inte på Windows utan Unix-shell. Bekräftat appfel.
- TEST-02: branding-testet förutsätter att NO_COLOR saknas.
- TEST-03: config.needsSetup och doctor-testerna ärver verkliga provider-nycklar från miljön; deras förutsättning "utan nyckel" är falsk.
- TEST-04: installer-testernas två kontroller förutsätter LF, misslyckas på CRLF-checkout.
- TEST-05: livedelivery-testet förutsätter Linux även på Windows.
- TEST-06: setup-testets tar-lista innehåller CRLF, jämförs utan trimning.
- TEST-07: version-testet undantar core/version.js med Unix-separator; Windows returnerar core\version.js.

OpenCode live-diagnos: officiell modellkatalog https://opencode.ai/inference/v1/models gav 85 ID:n. Officiella dokumentationen https://opencode.ai/v2/docs/console/models/ anger longcat-2.5-preview-free som gratis. Ett anrop med exakt denna modell, max_tokens=16, ingen fallback, till dokumenterad https://opencode.ai/inference/openai/v1/chat/completions gav HTTP 403 med error.type=FreeTierError: "OpenCode's free tier can only be used from within OpenCode." Det är en leverantörsbegränsning, inte bevis för ogiltig nyckel. Ingen lyckad extern inferens. Betalda modeller har inte testats. Äldre Go-preset och nuvarande API-adresser behöver särskiljas; gratis tillgång från MAJIN kan inte utlovas eller kringgås.

### Checkpoint 3 — korrigeringar och omtest
- Windows helsvit nu 412 tester: 397 godkända, 15 överhoppade, 0 fel. En ny skip är uttryckligen Linux/macOS-installationskontraktet; Windows verkliga installation testas separat i CI.
- Edge UI acceptance godkänd efter åtgärd av dubbla svar. Före fix gav den 5 svarsrader där 4 väntades; orsaken var att loggbussens payload skrev över agent.answer med answer. Händelsetyp och sekvens skyddas nu.
- WIN-01 åtgärdat: kommandoverifiering använder appens system-shell. Ny test kör riktiga Node-kommandon med exit 0 och 3 på Windows.
- WIN-02 åtgärdat: shell-valet kontrollerar faktiskt pwsh/PowerShell/cmd istället för att alltid välja pwsh. Import av dirs saknades dessutom i shell.run när config-workspace/cwd saknas; åtgärdat och testat.
- BUILD-01: installationsarkivets verkliga sökvägar innehöll backslash på Windows. Byggaren använder nu POSIX-sökvägar i tar, verifierat genom faktisk payload-build och tar-listning.
- BUDGET-01: chattkommandot /budget sparade mode=limit men budgetspärren kräver cap. Rättat till cap; browser-regressionstest ska läggas till.
- API-01: även installerad officiell OpenCode CLI 1.18.32, --pure och explicit longcat-2.5-preview-free, returnerade samma FreeTierError/403. Ingen fallback eller betald modell användes. Kvarstående leverantörsåtkomstproblem. MAJIN förklarar nu detta som accesspolicy, inte automatiskt fel nyckel; generisk HTTP403 behandlas också som åtkomstfel.
- TASK-01 upptäckt vid kodgranskning: uppföljning på avslutad task kördes med oförändrad terminal status, ignorerade telemetry och Workspace höll kvar "done". Åtgärd pågår med uttryckliga run-nummer som skiljer verklig uppföljning från sena events; återstår test.

### Checkpoint 4 — bredare kontroll
- TASK-01 implementerat: uttrycklig uppföljning ökar run-numret, behåller samma session, återställer per-run-telemetri. Workspace accepterar ny run men avvisar gamla snapshots och sena events. Enhets- och verkligt HTTP-test tillagda; körning pågår.
- PRICE-01: backend kunde klassificera null/tomma/boolska priser som gratis och ignorera extra avgifter. Korrigerat med strikt prisparsning; extra avgifter bevaras i ursprungliga enheter och blockerar gratisstatus. Tokencost-beräkningen är fortfarande endast en golvuppskattning för modeller med andra avgifter.
- HOST-01: prefix-regex för lokal server accepterade t.ex. localhost.example.com som lokal/gratis/utan nyckel. Nu parsas hostname och endast riktiga loopback/RFC1918-adresser accepteras. Regressionstester tillagda.
- OpenCode onboarding visar nu presetens faktiska villkor: Go kräver prenumeration; gratisnamn innebär inte gratis API-åtkomst från MAJIN.
- Nya HTTP-tester täcker Workspace-datakällor och minnes-spara/sök/glöm i isolerad testprofil. Browser-test kompletterat för /budget och uppföljningars status.
- Ett tillfälligt Git-fel "No space left on device" inträffade under checkpoint; omförsök med explicita källfiler lyckades. C: hade ca 531 MiB ledigt vid kontroll. Ingen användardata raderades. Kodcheckpoint 6168e61 finns lokalt; ska pushas tillsammans med nästa checkpoint.

### Checkpoint 5 — HTTP-skrivtester hittade verkliga funktionsfel
- API-02: GET-handlers för /api/memory, /api/skills och /api/schedule saknade metodvillkor. De fångade POST/DELETE och returnerade listor istället för att spara eller radera. Alla tre rättade till GET-only; nya verkliga HTTP-tester verifierar minnes-spara/sök/glöm, skill-fil, framtida schemaläggning/listning/radering och felaktig tid (422). 46 riktade tester är gröna.
- MEMORY-01: remember/forget skrev gamla minnen utan listprefix, medan facts-läsaren ignorerade sådana rader. Äldre minnen försvann därmed ur läsningen efter ändring. Skrivning bevarar nu prefix; läsning återhämtar äldre prefixlösa rader. Regressionstest med omstart/återläsning tillagt.
- /api/memory forget svarade dessutom ok som ett nästlat objekt. Returnerar nu normalt booleskt ok med removed.
- Browser-testet passerar igen, inklusive verklig demo-inferens/stopp, felaktig Stop-ack, /budget cap och Workspace run=2. Ingen betald inferens.
- CI kompletterad med hela npm test även på Windows, utöver Linux-svit, Edge browser-tool E2E och installationstester.
