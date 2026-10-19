# MAJIN handover — v0.9.1 funktionstest och felrättningar

Uppdaterad 2026-10-19. Lokala slutkontroller är gröna. Leveransens GitHub-status och exakta merge-SHA finns i PR https://github.com/rssen-debug/MAJINCLI/pull/59 ; installer/release byggs av CI efter merge. Chats outputs/handover.md kompletteras med leveranskvittot efter publicering.

## Snabböverlämning till nästa utvecklare
- Repo: https://github.com/rssen-debug/MAJINCLI ; arbetsgren fix/windows-functional-audit ; version 0.9.1.
- Lokal repo: C:/Users/krist/Documents/Codex/2026-10-19/har-du-tillg-ng-till-min/work/MAJINCLI
- Denna fil: repo-root handover.md. Användarens läskopia: C:/Users/krist/Documents/Codex/2026-10-19/har-du-tillg-ng-till-min/outputs/handover.md
- Alla bekräftade produktfel från testkörningarna nedan är rättade med regressionstester. Läs kvarstående åtkomsthinder/begränsningar innan något kallas helt verifierat.
- Nycklar finns inte här eller i implementationen. Kör isolerat med MAJIN_HOME. Gratis modellnamn räcker inte som kostnadsbevis; ingen betald fallback har använts under denna audit.

## Slutresultat lokalt på Windows
| Kontroll | Resultat och faktisk omfattning |
|---|---|
| Node v24.14 full svit | 431 tester: 416 pass, 15 skip, 0 fail. Provider-key-env borttagna från testprocessen. 34,4 s. |
| Edge UI acceptance | Pass. 1200 kontrollerade modellposter, filterintersektion/pagination/sortering/exakt sparad route, fokus/Escape, 6 HTTP-felfall, bevarad draft, svar utan delta, lyckat/misslyckat stopp, ny chatt, 390/1440/1920 px, tema, contextual panels, run=2, /budget cap, filnedladdning, sandboxad preview, reduced-motion. Modell/task-fixtures är inte riktiga specialistagenter. Demo-chatt/stopp och filbytes går genom verklig lokal backend. |
| Verklig browser-tool E2E | 5/5 pass: formulär inkl select/radio/checkbox, hashnavigation, riktig ny flik, iframe-via-direktadress, testbutik sök/kundvagn/beställning, filuppladdning/skärmbild, testansökan med bevis. Alla formulärservrar lokala, inga verkliga köp eller externa meddelanden. |
| HTTP och persistens | Verkliga serveranrop: minne spara/sök/glöm och bevara äldre anteckningar, skill-fil/lista, framtida schema/lista/radera, felaktig tid 422, task-uppföljning status running -> done i samma session. |
| Syntax / språk / diff | 160/160 filer parse, npm run i18n, git diff --check pass. |
| Visuell kontroll | Faktiska Edge-skärmbilder granskade. outputs/audit-ui innehåller bevisbilder; skärmbilden acceptance-failure.png är en sparad FÖRE-fix-failure, inte slutresultatet. |
| OpenCode live | Officiell katalog nåbar, 85 ID:n. Endast dokumenterad gratis longcat-2.5-preview-free prövad, max_tokens=16 direkt API. HTTP403 FreeTierError både direkt och i installerad officiell CLI 1.18.32 --pure. Ingen lyckad extern inferens. |
| CI | Linux full svit + UI, nu även full svit på Windows, browser-tool live E2E och bygg/installation/omstart/avinstallation/återinstallation. Aktuell status läses via PR59. |

## Rättade produktfel
| ID | Repro/fel | Åtgärd |
|---|---|---|
| WIN-01 | command_exits_zero startade /bin/sh på Windows | Använder system-shell; riktiga exit 0/3 kontrolleras. |
| WIN-02 | shell valde alltid pwsh även om det saknades; dirs-import saknades vid default cwd | Probe med fallback PowerShell/cmd, dirs importerat. |
| BUILD-01 | Windows-tar innehöll dist\\... istället för portabla /-sökvägar | POSIX archive paths, verklig payload-build/listning testad. |
| CHAT-01 | Svar duplicerades som schemalagt när global bus tappade agent.answer-prefix | Bus reserverar type/id/ts/level; UI-stopprace test passerar. |
| BUDGET-01 | /budget skrev limit, motorn läser cap | Kommandot skriver cap; browser läser tillbaka korrekt inställning. |
| TASK-01 | Uppföljning kördes men Registry/Workspace höll kvar done och ignorerade telemetri | Explicit nästa run i samma session, run-nummer i snapshot, gamla callbacks filtreras. |
| API-02 | POST memory/skills/schedule och DELETE schedule fångades av GET-handlers | GET-villkor; mutationsflöden verifieras över verklig HTTP. |
| MEMORY-01 | Minnesändringar tappade äldre listprefix; läsning dolde gamla anteckningar | Prefix bevaras, äldre prefixlösa rader återläses, spara/glöm/omstart testat. |
| API-03 | memory forget gav ok som nästlat objekt | Normalt booleskt ok + removed. |
| PRICE-01 | null/blank/bool-priser och extra avgifter kunde behandlas som gratis i backend | Strikt typ/finite/nonnegative-validering, extra avgifter blockerar gratisstatus. |
| HOST-01 | localhost.example.com och andra prefix-lookalikes ansågs lokala/gratis | URL-hostname parsas; endast faktiska loopback/RFC1918-värdar. |
| BROWSER-01 | Edge sync-dialog följdes som om den kom från klicket; 5 live-tester föll | Kräver openerId från aktuell kontrollerad flik; uppdaterar target vid nya flikar; 5/5 omtest grönt. |
| ACCESS-01 | HTTP403 visades alltid som fel/deletad API-nyckel | Åtkomstpolicy förklaras separat, inklusive OpenCodes FreeTierError; ingen betaluppmaning i detta fall. |

## Kvarstående hinder och ärliga begränsningar
1. **OpenCode gratisåtkomst är blockerad av leverantören.** Samma nyckel och gratis-ID gav FreeTierError även i den installerade OpenCode-klienten. Nästa dev bör utreda konto-/klientåtkomst med OpenCode. Försök inte lösa det genom att byta till betalda modeller eller förfalska klientidentitet. Go-preseten behålls för befintliga Go-konton och onboarding visar prenumerations-/gratistier-villkoren.
2. **Äldre sparade modell-ID:n/presets kan vara inaktuella.** Live-katalog och modellfelsåterhämtning är testade. Användaren måste välja ett faktiskt tillgängligt ID; audit byter inte tyst gamla rutter till andra potentiellt betalda modeller. Varje providers modell-ID och inferens kräver separat verifiering med rätt konto.
3. **Kostnadssiffror är tokenestimat.** Extra request/image/cache-avgifter räknas inte fullt ut i Usage; de blockerar nu gratisstatus men kan innebära högre faktura. ImportPricing fyller endast luckor och skriver inte över befintliga användarpriser. Inget påstående om exakt totalfaktura.
4. **Extern slut-till-slut-inferens saknar godkänt resultat.** Demo, stubs, HTTP, lokala browser-flöden och providerfelfall verifierade; inte en riktig OpenCode-agent som slutför ett skapandeuppdrag.
5. **Externa kontobundna integrationer ej live-verifierade:** Telegram/WhatsApp, riktiga Meta/TikTok/Google Ads-konton, domänregistrering, live trading, verkliga arbetsansökningar/externa meddelanden. Enhets-/stubtest är inte bevis för ägarens konton. Inga sådana externa åtgärder gjordes.
6. **Historik-UX:** återöppning laddar de senaste 40 meddelandena. 300-meddelandes rendering/scroll testad, men ingen ny äldre-historik-pagination implementerad.
7. **Lokalt diskutrymme:** ett Git-skrivförsök gav tillfälligt No space left on device; retry lyckades. C: hade ca 0,5–1,1 GiB fritt under auditen. Ingen ägardata raderades.

## Återuppta och verifiera
- npm test ; npm run check ; npm run i18n
- Windows Edge UI: MAJIN_UI_BROWSER=msedge npm run test:ui (sätt env i PowerShell, använd isolerad output).
- Windows browser-tool E2E: MAJIN_BROWSER_LIVE=1 node --test --test-concurrency=1 test/browser.live.test.js test/jobs.live.test.js test/browser-domains.live.test.js
- gh pr checks 59 --repo rssen-debug/MAJINCLI ; kontrollera att check och exe gäller sista head-SHA innan merge.
- Installera inte över ägarens app som del av fortsatt automatisk testning. CI kör verklig installation i isolerad runner. Ägarens installerade app har inte uppgraderats i denna audit.

---

## Kronologiska checkpoints
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

### Checkpoint 6 — slutlig lokal kontroll och ytterligare browser-fynd
- Nuvarande Windows helsvit: 431 tester, 416 godkända, 15 överhoppade, 0 fel, med provider-API-nycklar borttagna ur testprocessens miljö. Syntax 160/160 och i18n grönt.
- Separat verklig browser-tool E2E gav initialt 5 fel på denna dator. Orsak: Edge öppnade sin egen sync-confirmation-dialog efter startup; tabbföljaren tog alla nya page-targets för klicköppnade flikar. Då hamnade fortsatta formulärklick/navigation/uppladdning på fel sida.
- BROWSER-01: fix pågår som kräver att nya flikens openerId matchar kontrollerad sida och uppdaterar aktuell target efter varje följd flik. Tabbar som Edge själv öppnar ska aldrig följas. Regressionstest tillagt; verklig browser E2E körs om.
- Task-uppföljningar kompletterade med run-nummer även på events och completion, så sena callbackar från en tidigare stoppad run inte kan avsluta den nya runnen.
- PR skapad: https://github.com/rssen-debug/MAJINCLI/pull/59. CI körs; ej mergad ännu. Nästa steg: färdigställ browser-test, kör slutlig helsvit/Edge UI, uppdatera denna logg, push och kontrollera CI för exakt sista commit före merge.

