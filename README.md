# MAJIN

**Everything on — always ready.** A local agent that lives on your own machine (Windows first),
runs its own configuration, and answers to you — in the browser window, from Telegram, or from
WhatsApp on your phone. No subscription, no hosted runtime: your keys, your models, your files.

MAJIN is a single Node.js process (or a single `.exe`) with a built-in web UI, 75 tools, a
tool-calling agent loop, Mixture-of-Agents answering, persistent memory and self-modifying
config. It ships with a real reverse-engineering stack (PE/ELF/APK/pcap parsers, a mini-YARA
engine, entropy and string analysis) because "read this file and tell me what it is" should not
need a second program.

```powershell
# Windows — from a clone of this repo
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
majin                      # starts the server and opens a window (Edge/Chrome --app mode)
majin doctor --full        # keys, tools, rules, port, workspace — everything at a glance
```

```bash
# Anywhere with Node 20.11+
node src/cli/majin.js doctor
node src/cli/majin.js
```

---

## Docs

* [docs/CONFIG.md](docs/CONFIG.md) — every config key, what it does, what it costs
* [docs/REVERSE.md](docs/REVERSE.md) — the 22 RE tools, the mini-YARA engine, rule files
* [docs/WINDOWS.md](docs/WINDOWS.md) — installer, data layout, ports, uninstall, stumbles
* [docs/EXE.md](docs/EXE.md) — how the single-file exe is built and why CI builds it
* [docs/BENCHMARKS.md](docs/BENCHMARKS.md) — deterministic scenario harness + reference numbers

## What it does

| | |
|---|---|
| **All tools, always** | No enable/disable ceremony. The model gets every tool, every step, and chooses. |
| **MOA by default** | Mixture-of-Agents: 3 reference models answer, an aggregator merges. Runs on every non-trivial turn. |
| **Self-configuring** | "use deepseek-v4-pro for analysis, always", "add my key", "confirm every dangerous thing" — MAJIN parses those and patches its own config, no config editing needed. |
| **Owns its keys** | Keys are stored in your local config file, never on a server. Add one in the UI, with `majin config`, or from your phone via a one-time pairing code. |
| **Reverse engineering** | 22 `re.*` tools: structured PE/ELF/Mach-O parsing, entropy, strings, yara (built-in mini engine + real `yara` if installed), APK/ZIP/pcap containers, hexdump, decompilers through external tools. |
| **Persistent memory** | Facts, events, sessions and auto-harvested skills as plain files under `~/.majin` (`%LOCALAPPDATA%\MAJIN` on Windows). |
| **Everywhere** | The same agent answers the browser window, Telegram and WhatsApp. Scheduled jobs run on their own. |

## Install

### Windows, from an executable

1. Grab `majin-win-x64.exe` — either the artifact from the **Build exe** GitHub Actions run for a
   tag, or the release asset when a `v*` tag has been pushed (see [docs/EXE.md](docs/EXE.md)).
2. Put it anywhere, then double-click it — it starts the server and opens a window. Or:

```powershell
.\majin-win-x64.exe doctor
.\majin-win-x64.exe start --no-window      # for Task Scheduler / service use
```

Nothing is installed system-wide. The exe unpacks nothing, writes nothing outside its data
directory, and needs no Node.js.

### Windows, from the repo (recommended while MAJIN is young)

```powershell
winget install OpenJS.NodeJS.LTS        # if you do not have Node 20.11+
git clone <this repo> && cd slurps
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`install.ps1` copies `src/`, `rules/` and the shims to `%LOCALAPPDATA%\MAJIN`, writes
`majin.cmd`/`majin.ps1` into `%LOCALAPPDATA%\Programs`, puts them on `PATH`, creates a
**MAJIN** task-scheduler entry that starts the server at login, adds a Start Menu shortcut
(with the Majin icon), and writes `~/.majin` (or `%LOCALAPPDATA%\MAJIN`) as the data home.

Flags: `-WhatsApp` (installs the Baileys optional deps), `-NoPath`, `-NoTask`,
`-Home <dir>`, `-Uninstall`. Details: [docs/WINDOWS.md](docs/WINDOWS.md).

### First run

Open the window (it opens itself). The UI shows a **key required** card until a provider key
exists. Any of these works:

```powershell
majin config set providers.deepseek.apiKey sk-...
majin config set models.provider deepseek
```

…or type the key in the UI's provider card, or from your phone with `majin pair telegram`.

Supported presets: OpenRouter, Nous, Groq, OpenAI, Anthropic, Gemini, Ollama, LM Studio,
DeepSeek, plus a `demo` mock provider that answers offline so you can try the loop with no key
at all.

## The CLI

```
majin                      start the server and open the window
majin start [--no-window]  run without a window
majin window               open another window on a running server
majin doctor [--full]      providers, keys, tools, RE rules, port, workspace
majin status | url | logs  what is running, the token URL, the log tail
majin config [get <key> | set <key> <value> | path]
majin pair telegram|whatsapp      connect a chat channel (one-time code)
majin send "text"                 one question through the agent
majin re <file> [--json]          RE analysis, no server needed
majin test                        the test suite
```

Useful env vars: `MAJIN_HOME`, `MAJIN_CONFIG`, `MAJIN_TOKEN`, `MAJIN_PORT`, `MAJIN_WORKSPACE`,
`MAJIN_LLM`, `MAJIN_VERSION`, `MAJIN_SHELL`.

## The window

The UI is one HTML file plus two classic scripts — no build step, no framework, no CDN. It
streams the agent's reasoning, tool calls and results live, and holds the controls you actually
use:

* **chips** for the current route, MOA state, tool count and cost, Telegram/WhatsApp status
* **mode** (Assist / Approval / Full auto) — what MAJIN may do without asking
* **panel** with provider keys, the 13 model routes, MOA width and policy, channel setup,
  scheduled jobs, memory, skills and the RE drop zone
* drag a file onto the window to analyse it; the report lands in the chat as evidence

Theme `jarvis` is default. Voice (wake word "MAJIN", speech in Swedish or English) is wired to
the browser's Web Speech API and off until you turn it on.

## Tools

75 tools, always all on. Risk is per tool, not per group — that is what the guard reads.

| prefix | count | tools |
|---|---|---|
| `fs` | 12 | list, read, write, patch, search, grep, move, copy, delete, stat, mkdir, tar |
| `shell` | 5 | run, bg, jobs, stop, env |
| `sys` | 7 | info, ps, ports, fs_usage, procs_top, services, notify |
| `net` | 5 | dns, tcp, http, serve, serve_stop |
| `screen` | 2 | capture, claim |
| `web` | 3 | search, fetch, download |
| `re` | 22 | analyze, strings, hexdump, search, entropy, sections, imports, exports, yara, iocs, overlay, extract, apk, pcap, diff, modules, tool, tools, disasm, unpack, hash, rules |
| `majin` | 15 | configure, routes, provider, moa, guard, memory, skill, schedule, channel, status, selftest, tools, backup, ui, control |
| `agent` | 4 | plan, delegate, moa, approve |

Every tool's parameters and examples: `GET /api/tools` (or the Tools card in the panel), and
`majin doctor` prints the count plus which subsystems are ready. Notes on the RE set and how the built-in parsers, YARA rules and external tools fit
together: [docs/REVERSE.md](docs/REVERSE.md).

## Guard rails

`guard.mode` is the only dial:

| UI label | `guard.mode` | behaviour |
|---|---|---|
| Assist | `strict` | every write, exec and destructive call is confirmed |
| Approval | `confirm` (default) | exec + destructive calls are confirmed |
| Full auto | `off` | nothing asks; `neverOn` still blocks |

`guard.neverOn` is a hard block list (regex), `guard.askOn` forces confirmation for patterns,
`guard.autoApprove` exempts `name` or `name:<hash>`, `guard.pathWriteRoots` limits where writes
may land (`auto` = workspace + data dirs). Deleting a workspace root, your home or a drive root
is refused outright — `fs.delete` on those returns `protected`, and quoting or `rm -rf /` inside
a shell string does **not** launder it. Destructive commands are matched on the parsed tokens, so
`echo "rm -rf /"` is not a threat while `rm -rf /` is.

Approvals time out (`tasks.approvalTimeoutMs`, default 30 min) and the timeout counts as *no*.

## Chat channels

```powershell
majin pair telegram      # print a code, send it to @yourbot
majin pair whatsapp      # QR in the terminal, or the QR card in the window
```

Telegram uses the Bot API over long polling (no public port). WhatsApp uses
`@whiskeysockets/baileys` (installed with `install.ps1 -WhatsApp` or
`npm i --include=optional`) and shows a QR code. Both channels get the same agent, the same
tools and the same guard — plus an allow-list, so strangers cannot order your computer around.
The raw WhatsApp webhook (`POST /api/webhook/whatsapp`) verifies `x-hub-signature-256` against
your app secret.

## Scheduling

`majin.schedule` / the panel's schedule card creates jobs: cron-ish or `every 30m`, a prompt, an
optional model route and a target channel. Jobs run in the same loop, isolated sessions, and post
the answer wherever you asked. `GET /api/schedule` shows the next run; `POST /api/schedule/run`
runs one now.

## HTTP API

Everything the UI does is HTTP with a token. `majin url` prints the URL with `?t=`.

```
POST /api/chat                SSE stream; ?stream=false gives one JSON object
GET  /api/state               config (redacted), routes, moa, guard, tools, usage, channels
GET  /api/events              log + tool event stream (SSE)
GET  /api/config              PATCH /api/config to change it (validated, diffed, backed up)
POST /api/intent              dry-run a natural-language config sentence
GET  /api/logs | /api/usage | /api/memory | /api/skills | /api/schedule | /api/approvals
GET  /api/sessions | /api/history?session= | /api/report | /api/file?path=
POST /api/re/upload?name= | /api/re/analyze | GET /api/tools | POST /api/tool
POST /api/approve | /api/provider/test | /api/session/clear | /api/usage/reset
POST /api/restart | /api/shutdown | GET /healthz | POST /api/webhook/whatsapp
```

Loopback (`localhost`, `127.0.0.1`, `[::1]`) is trusted without a token so the window works;
everything else needs `?t=`, `authorization: Bearer`, the `majin=` cookie or `x-majin-token`.
Set `server.trustLocal: false` to require a token even locally. The loopback trust only applies to
packets that really come from loopback, so a remote request forging `Host: localhost` gets 401 —
`server.allowRemote: true` is what opts into host-based trust from any peer (tunnel/VPN first).

## Development

```bash
npm install
npm run check            # syntax-parses every source and test file
npm test                 # 59 tests, no network, no keys
npm run doctor
node src/cli/majin.js send "what is in this folder?"
```

The test suites are `config`, `selfconfig`, `router-moa`, `tools`, `re`, `agent` (end-to-end
against the `demo` mock provider) and `server` (a real child process on a free port).
Building the exe and the CI recipe: [docs/EXE.md](docs/EXE.md). Benchmarks:
`npm run bench` (mock provider, deterministic — what the harness measures and what it does not is
spelled out in [docs/BENCHMARKS.md](docs/BENCHMARKS.md)).

## Layout

```
src/cli/majin.js        CLI: start, doctor, config, pair, send, re, test, window
src/core/runtime.js     one mount point: config → memory → skills → registry → agent → channels
src/core/agent.js       turn: route → loop → MOA → memory
src/core/loop.js        the tool loop (shared with subagents)
src/core/router.js      natural language → config patch
src/core/routes.js      job classification
src/core/moa.js         Mixture-of-Agents
src/core/guard.js       modes, askOn/neverOn, approvals
src/core/server/        HTTP + SSE + static UI, token auth
src/core/tools/         the 75 tools, nine groups
src/core/binary/        PE, ELF, Mach-O, containers, entropy, strings, YARA subset
src/core/channels/      telegram (long poll), whatsapp (baileys)
src/core/provider/      openai-compat, anthropic, gemini, mock/demo
src/ui/                 index.html + app.js + panels.js + logo.png
rules/*.yar             your YARA rules, seeded into <home>/rules on first run
scripts/                build-exe.mjs (esbuild + pkg), bench.mjs, parse-all.js, clean.js
install.ps1             Windows setup (bin, PATH, task, start menu, icon)
```

## Privacy and limits

* MAJIN sends your prompt (and file excerpts you drop in) to whichever provider you configured.
  Nothing is sent anywhere else; `web.*`/`net.*` only do what you or the agent asks for.
* Keys live in `<home>/config.json` (0600 on POSIX). Redaction is enforced on every read
  endpoint: no route returns a raw key.
* `majin re` reads files; it never executes them. External decompilers are only used if you have
  them installed, and `re.tool` refuses politely when they are missing.
* The agent can delete and can run commands. That is the point, and the reason the guard exists.
  Read [the guard section](#guard-rails) before you turn on Full auto.
* Windows-first, not Windows-only: the core runs on macOS and Linux; `install.ps1`, the task
  registration, `.lnk` and the icon are Windows-only. Screen capture and clipboard go through
  whatever OS tools exist, so they degrade instead of crashing.

MIT — see the license field in `package.json`.
