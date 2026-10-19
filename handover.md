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
