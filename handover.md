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
| Node v24.14 full svit | 432 tester: 417 pass, 15 skip, 0 fail. Provider-key-env borttagna från testprocessen. 26,3 s. |
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
| CHAT-01 | Svar duplicerades som schemalagt när global bus tappade agent.answer-prefix | Bus skyddar eventtyp och separat seq, bevarar domän-ID för approval-knappar; UI-stopprace test passerar. |
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
7. **Lokalt diskutrymme:** ett Git-skrivförsök gav tillfälligt No space left on device; retry lyckades. C: gick senare fullt när gamla testbrowserprocesser levde kvar. Efter att endast audit-processer stoppats återhämtades ca 3,5 GiB ledigt. Ingen ägardata raderades; browser.close är nu rättad och live-verifierad.

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


### Checkpoint 7 — godkännanden och browser-livscykel
- Slutgranskning hittade en regression i den nya bus-fixen: om event-ID reserveras för sekvens tappar approval-knappar sitt domän-ID. Rättat före merge: separat seq för stream/tail, ursprungligt approval.id bevaras, eventtyp skyddas. Nytt test begär och nekar en riktig lokal approval genom det ID som UI-eventet får.
- APPROVAL-01: UI kvitterade även ok=false som lyckat godkännande och stängde knapparna. Kräver nu ok=true; Edge-test använder verklig backendavvisning för ett utgånget test-ID och verifierar att ingen falsk tillåten-status visas.
- BROWSER-02: på denna dator återstartar Edge sig med ny PID. Gamla browser.close dödade endast startprocessen, så headless-profilerna fortsatte och förbrukade systemresurser. CDP Browser.close skickas nu först, och tool-anropet väntar på stängningen. Verkligt live-test verifierar att debugporten blir onåbar. Alla 5 browser-tool E2E passerar, inga testbrowserprocesser kvar efteråt.
- ENV-01: C: gick helt fullt under testning. Automatisk granskning blockerade radering av fyra namngivna audit-temp-profiler ("blocked by policy"); ingen sådan radering gjordes. Två egna äldre nedladdningskopior i work/ togs bort. Efter att kvarvarande audit-browserprocesser stoppats återhämtades ca 3,5 GiB ledigt. Ägarens vanliga browserprofil/appdata rördes inte. Begäran om att användaren skulle frigöra plats behövs inte längre.
- En omkörning under samtidig hård CPU/diskbelastning gav timeout i testets 5-sekunders kommando-fixture. Testfönstret för kall Windows-shell är nu 30 s; appens användarkonfigurerade timeout är oförändrad. Hel svit körs om ensam.
- CI för tidigare head 1b64249 passerade både check och exe, inklusive full Windows-svit och installation. Slutliga kompletteringar ovan behöver egen grön CI före merge.


### Checkpoint 8 — sista lokala gröna resultat
432 tester: 417 pass, 15 skip, 0 fail (26,3 s). Edge UI pass inklusive avvisad approval-ack. Fem verkliga browser-tool E2E pass inklusive kontroll att browser.close stänger debugporten. Syntax 160/160 före sista komplettering samt syntaxcheck av ändrade JS-filer pass; språkcheck pass. Denna slutliga kod ska nu verifieras av CI före merge. Inga fler källändringar planerade om CI är grönt.

### Checkpoint 9 — CI fångade ytterligare navigationsrisk
- CI-run 39304092994: Linux full svit 418 pass/14 skip/0 fail; Windows full svit 417 pass/15 skip/0 fail; byggen skapade. Browser E2E 4/5 pass, testbutikens första fill #q returnerade ok=false (browser.open hade returnerat ok=true). Ej mergat. Automatisk CI-rapport skapade issue #60.
- BROWSER-03: kodgranskning bekräftade att goto väntade på document.readyState utan att identifiera det NYA dokumentet. Ett gammalt about:blank med readyState=complete kunde räknas som färdig navigation. Nu krävs Page.navigate-resultatets loaderId i Page.getFrameTree samt interactive/complete. Nav-fel och utebliven färdig sida ger ärliga fel istället för framgång. Detta adresserar en bekräftad race i koden; CI-felets tidigare logg saknade detaljer om fill-felet, så nytt omtest krävs för att fastställa CI-resultatet.
- Nytt deterministiskt regressionstest håller tillbaka gammal ready-sida, väntar genom loading, accepterar rätt loader, nekar timeout/nätverksfel och stödjer same-document-navigation utan nytt loaderId. Protokollreferens: https://chromium.googlesource.com/devtools/devtools-frontend/+/refs/heads/chromium/7879/third_party/blink/public/devtools_protocol/domains/Page.pdl
- Browser-open-felvägen skickar också Browser.close före websocket/process-cleanup, så en misslyckad navigation inte lämnar en återstartad Edge-process.
- Testbutikens öppning/fill skriver nu konkreta fel/URL-metadata i assert vid ett framtida fel, istället för bara false != true. De 10 browser-enhetstesterna är gröna; verkliga browserflöden körs om.

## v0.9.2 UI refinement — pågår
Användarens korrigering: byt den generiska välkomsttexten/chipsen och den rosa Send-pillern. Behåll övrig Aurora-design. Implementera avskalad välkomstyta och rund ikonknapp med riktiga Send/Stop-tillstånd, interaktionsanimationer och reduced-motion. Testa visuellt i Edge före leverans. Ingen modellinferens behövs för denna ändring.

### v0.9.2 implementerat och lokalt verifierat
- Välkomstytan består av en långsamt animerad MAJIN-symbol och ”What’s next?”. Slogan och förslagschips borttagna; övriga Aurora-ytor bevarade.
- Rund 44 px ikonknapp: pil för skicka, fyrkant för verkligt stopp. Hover-glöd, ikonrörelse och tryckrespons. Stabil klickyta; en första version flyttade knappen och kunde fördröja snabba stoppklick i Edge. Detta upptäcktes och korrigerades.
- Tomt meddelande inaktiverar skicka; stopp fungerar även med tomt skrivfält. Tillgängliga namn uppdateras mellan Send message och Stop response. Reduced motion respekteras.
- Windows/Edge: hela browseracceptansen PASS, inklusive Enter-skicka, bekräftat stopp, misslyckat stopp, 6 leverantörsfel, 1200 modeller, filter, Workspace, preview, small viewport. Visuellt granskat desktop, 390 px och stoppläget.
- Full lokal testsvit: 433 tester, 418 godkända, 15 avsiktligt hoppade, 0 fel. Parse: 160/160. i18n: exit 0. Inga betalda modellkörningar.
- Evidens finns i arbetschattens outputs/quiet-ui/. Nycklar har inte skrivits i kod eller handover. OpenCode FreeTierError från tidigare audit kvarstår enligt tidigare anteckningar; denna UI-ändring kräver ingen inferens.
- Nästa steg: push/PR, Linux- och Windows-CI, därefter merge och verifiering av v0.9.2-release.

## v0.9.3 provider/update audit — pågår
Krav från användaren: BEHÅLL Aurora UI/UX från v0.9.2, inklusive välkomstyta och rund Send/Stop. Fixa providerfunktion och dokumentera kvarvarande hinder för dev. Nya verifierade kodluckor: Gemini chatUrl pekade på native-bas men skickade OpenAI-body; Anthropic /models saknades; verktyg/API hade olika kataloghämtning, kapning vid 400 modeller och ingen pagination. Uppdateringsknapp/installationsflöde granskas också. Ingen betald inferens tillåten.

### Checkpoint: provider- och uppdateringsfixar implementerade
- Gemensam katalogkod för UI/API och agentverktyget, utan inferens. Anthropic native auth + cursor-pagination; Gemini native lista + pageToken, rätt OpenAI-kompatibel chat-URL; Alibaba/Qwen workspace/region-endpoint + native modellista och sidnummer. Alla hämtade modell-ID sparas, ingen 400-kapning. Prefix i vendor/model bevaras.
- Katalogfel får inte se ut som framgång eller spara en partiell/uppdiktad lista. Nycklar från miljövariabler och custom headers fungerar även vid kataloghämtning. Pagination får aldrig skicka nyckeln till annan origin.
- Qwen och separat OpenCode Zen tillagda; befintlig Go-konfiguration bevarad. Custom endpoint kan välja OpenAI-kompatibel, Anthropic eller Gemini samt eget anslutningsnamn. Endpoint kan justeras för region/workspace i dolda anslutningsalternativ. UI/UX-designen från v0.9.2 BEHÅLLS.
- Update: bekräftelseläge överlever statusrefresh, dubbla installationer blockeras, knappen döljs vid up_to_date. Installerstart måste bekräftas av Windows innan appen stängs. Efter backend-versionbyte laddar UI om och återställer aktuell session/osänt utkast (från v0.9.3-klient och framåt).
- Live OpenCode 2026-10-19: Zen /models HTTP 200 med 47 modeller, Go /models HTTP 200 med 37. LongCat 2.5 Preview Free via Zen chat/completions: HTTP 403 FreeTierError. Nyckeln felklassas inte som ogiltig. Ingen betald fallback körd. Bildens äldre 200-anrop ändrar inte det nya testresultatet.
- Kvar att verifiera: nya integrationstester, Windows/Edge, full svit, CI, merge och release. Alla andra leverantörers riktiga konton kräver respektive nyckel/kvot; lokala protokolltester är inte bevis för kunders faktiska åtkomst. Ostandardiserade protokoll (t.ex. AWS SigV4/Responses-only) kräver separat adapter, inget löfte om varje API i världen.

### Testcheckpoint före PR
Full lokal Windows-svit: 441 tester, 426 pass, 15 skip, 0 fail. Den första omkörningen hittade saknad felhint och ändrad katalogordning; båda rättade och omtestade. 162/162 JS-filer parse; i18n exit 0. Edge update-/resume-tester passerar; custom-provider-save granskas också. Devs konkreta återstående arbete och uttryckligt BEHÅLL UI/UX-krav finns i docs/PROVIDER-UPDATE-HANDOVER.md (användarkopia outputs/DEV-HANDOVER.md). Full uppgradering äldre->nyare via appknapp på separat VM ska fortfarande verifieras; befintlig installation lämnad orörd. Senaste direkta OpenCode-gratisanrop ger 403 FreeTierError.

### Lokal verifiering klar
Edge: även custom Anthropic-anslutning med eget namn sparades via riktig API-route och valdes i modellväljaren; huvuddesignen visuellt bevarad. Tester för updater/draft/session och övrig browseracceptans PASS. Full svit 426 pass, 15 skip, 0 fail. Ingen egen datainstallation ändrad. Nästa steg är PR och CI före merge.

### Korrigerat OpenCode-liveutfall — 19:34 UTC, senaste bevis
OpenCode Go fungerar nu med användarens nyckel och longcat-2.5-preview-free via MAJIN complete(): vanligt svar OK (52 tokens) och streaming OK med deltas OK (38 tokens), maxTokens 128. Zen gav tidigare 403 FreeTierError. MaxTokens 16 på Go gav tom text, så en för liten testbudget kan ge missvisande tomt svar. Ingen betald modell/fallback körd. Tidigare kategoriska formuleringar om gratisåtkomst korrigerade i preset, feltext och dev-dokument. Evidens utan nyckel: outputs/opencode-live-check.json. Behåll Go/Zen åtskilda och lova inte stabil framtida åtkomst utifrån ett lyckat prov.
