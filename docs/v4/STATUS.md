# MAJIN V4 — vad som fungerar, vad som är blockerat

**Uppdaterad:** 2026-10-23 · **Commit:** se `git log -1` · **Branch:** `v4/main`

Det här dokumentet är skrivet för att svara på frågan *"körs det på min dator?"* — inte
*"finns koden?"*. Allt som kräver Windows, en telefon eller en nyckel står som **BLOCKERAT**
tills du har kört kommandot som bevisar det.

## Fungerar och är testat (368 tester i den här miljön)

| Område | Bevis |
|---|---|
| Parkoppling, sessioner, CSRF, rate limits, återkallning | `security.test.js` |
| Chatt med streaming, avbrott, återanslutning | `conversation.test.js`, `turns.test.js` |
| Mål, kvitton, verifiering mot disk (SHA-256) | `conversation.test.js` |
| Kraschåterhämtning till BLOCKED, resume mot inspelat hash | `crash.test.js`, `resume.test.js` |
| Kontextbudget (historiken ryms i modellens fönster) | `context.test.js` |
| Minne läses in i prompten (inte bara skrivs) | `memory.test.js` |
| Verktygsfel klassas, begränsad återhämtning | `agent-failures.test.js`, `recovery.test.js` |
| **Alla registrerade verktyg når modellen** (buggen du rapporterade) | `tool-exposure.test.js` |
| **Owner Mode** — behörighet från telefonen, omedelbar återkallning | `owner-mode.test.js` |
| **Skills** — job-search och fix-code som data, inte appkod | `skills.test.js` |
| **Filuppladdning** från mobilen, typkontroll, sandboxade förhandsvisningar | `uploads.test.js` |
| Riktig klientkörning i DOM (uppladdning, preview, behörigheter) | `client-dom.test.js` |
| Backup/restore, uppgradering med rollback, supervisor | `backup.test.js`, `upgrade-git.test.js`, `supervisor.test.js` |
| Telemetri utan meddelandeinnehåll | `telemetry.test.js` |

## BLOCKERAT — kräver din maskin

| Påstående | Varför det inte är bevisat | Kommandot som bevisar det |
|---|---|---|
| Windows-verktyg utförs (`control.type`, `control.list_windows`) | kräver Windows + interaktiv session | `npm run v4:tools -- --probe` |
| PowerShell/`exec.*` kör kommandon | kräver din maskin | samma |
| Edge/webbläsare styr sidor | kräver webbläsare + Playwright | `npm run v4:e2e` |
| Riktig inferens via OpenCode Go | ingen nyckel i den här miljön | `npm run v4:accept` |
| iPhone/Android över Tailscale | ingen telefon, ingen tunnel | `npm run v4:accept -- --url https://…` |
| Automatisk uppdatering utan PowerShell | **inte byggd** — se nedan | — |
| PDF/DOCX-textutvinning | **inte byggd** — uppladdning tar emot filen, men MAJIN läser den inte | — |

## Inte byggt alls (och varför)

1. **Automatisk uppdatering** (din punkt 6). Att bygga en uppdaterare som hämtar och kör kod
   kräver en signerad release-kanal och en nyckel. Utan signaturverifiering är en auto-updater
   ett fjärrexekveringshål — värre än att köra `git pull`. Det måste designas med dig, inte
   gissas. `npm run v4:upgrade` finns som manuell, testad väg med automatisk rollback.
2. **PDF/DOCX-utvinning** (din punkt 4). Uppladdningen tar emot och validerar filerna, men
   MAJIN kan inte läsa texten i dem. DOCX är genomförbart med `node:zlib`; PDF kräver ett
   bibliotek. Det är nästa naturliga steg.
3. **MCP/CUA.** Jag hittade ingen `cua-driver` eller MCP-klient i repot. `computer.use` finns
   men är en Reasoner-loop över `control.*`, inte en MCP-server. Att påstå MCP-stöd vore fel.

## Så verifierar du kedjan själv

```powershell
cd C:\MAJINCLI
git pull
npm ci

# 1. vad maskinen kan
npm run v4:tools

# 2. att verktygen faktiskt körs
npm run v4:tools -- --probe

# 3. att modellen ser dem (kräver din OpenCode-nyckel i MAJIN-konfigurationen)
npm run v4:accept -- --url https://<din-tailscale-adress> --write
```

Skicka utskriften från de tre kommandona. Då kan jag flytta påståendena i tabellen ovan från
BLOCKERAT till bevisat — eller laga det som visar sig vara trasigt.
