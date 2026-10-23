# Verify the tools on your Windows host

The bug report said: *"V4 can only use five workspace tools."* That was true, and the
cause was the agent sending a hardcoded tool list to the model. It is fixed in code.
This page is how you prove it on the machine that matters.

## 1. See what your host can do

```powershell
cd C:\MAJINCLI
git pull
npm ci
$env:MAJIN_V4_HOST_TOOLS = "1"
npm run v4:tools
```

Expected on a normal Windows 11 box: `desktop`, `screen`, `computer`, `files`, `shell`,
`power`, `web`, `research`, `jobs`, `agent`, `flows`, `github` listed as `ok`, and
`browser` either `ok` (with a path to `msedge.exe`) or `n/a` with a reason.

If a lane says `n/a`, it prints **why**. None of them fail silently.

## 2. Prove each tool actually executes

```powershell
npm run v4:tools -- --probe
```

This calls one tool per lane **through the same runner and approval layer the agent
uses**, and prints the outcome. What "pass" means per line:

| Probe | Pass means |
|---|---|
| `workspace_list` | the workspace tool ran |
| `memory_search` | the memory store answered |
| `fs_stat` | a real path on your disk was stat'ed |
| `exec_start` | a real child process started (a harmless `echo`) |
| `control_list_windows` | **your desktop's real windows were enumerated** |
| `web_search` | a real search answered, or an honest `NETWORK_FAILURE` |
| `browser_open` | a real browser launched and loaded example.com |

`TOOL` lines are classified failures from the tool itself (no internet, no consent).
`FAIL` lines are broken adapters and make the command exit non-zero.

## 3. Prove the model sees them

The phone uses the same agent. With the host tools enabled, ask MAJIN:

> Vilka verktyg har du? Lista dem kort.

Then ask something that requires a real one:

> Läs filen C:\Users\<du>\Documents\test.txt

If the model can name the tool and the call lands, the exposure is real.

## 4. The acceptance scenario

> Hitta mitt CV på Windows, sök fem riktiga jobb och öppna tre av dem i Edge.

What each step uses:

| Step | Tool | Needs |
|---|---|---|
| find the CV | `fs_search` over an allowed folder | host tools on, folder allowed |
| read it | `fs_read` | — |
| search jobs | `jobs_search` / `web_search` | internet |
| open listings | `browser_open` | Edge or a Playwright binary |
| approval | `process` tier tool pauses the turn | your tap on the phone |

Sensitive steps (anything with tier `process`, including the shell and the delete tool)
**pause and ask**, by design. That is the approval you asked for.

## 5. If something is missing

Run `npm run v4:tools --json` and send that output. It names every lane, every tool,
every tier and every skip reason — enough to fix it without guessing.
