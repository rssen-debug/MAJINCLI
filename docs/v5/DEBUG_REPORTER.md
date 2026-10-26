# MAJIN V5 — opt-in OpenCode debug reports

This is an **outer OpenCode launcher**, not an integration into MAJIN tool internals. It records only UTC start/end time, duration, exit code, a generic status and schema. It cannot report internal errors or tools from OpenCode/MAJIN. There is **no collection of terminal output, prompts, CVs, emails, browser contents, secrets, environment variables, or paths**.

The GitHub repository is public, so **even sanitized metadata becomes public** if the opt-in reporter is enabled. Never place sensitive information in the debug-report folder.

Windows (PowerShell), after a pull:
```powershell
$repo = "$env:LOCALAPPDATA\MAJIN\cli-20261026-084150"
Set-Location $repo
node .\scripts\v5\opencode-debug.mjs --status
node .\scripts\v5\opencode-debug.mjs --enable   # explicit opt-in
node .\scripts\v5\opencode-debug.mjs --run      # starts OpenCode; on exit attempts a PR
```

Requirements: Node.js >=22, OpenCode CLI, git and GitHub CLI (`gh`) installed and authenticated (`gh auth login`; `gh auth setup-git` may be needed). The wrapper runs OpenCode with inherited terminal IO. Each completed session writes a sanitized local outbox report. If opted in, it attempts to create a separate branch and PR on `rssen-debug/MAJINCLI`. Upload failures leave pending reports in the outbox; use `--flush` after fixing connectivity/authentication. No automatic merge, no code changes on main.

Use `--disable` to stop future uploads. Existing queued reports remain local. Use `--status` to check opt-in and queued count.

**Limitations:** Only sessions launched with `--run` are tracked. An abrupt OS shutdown or killed wrapper may not save a report. This does not capture MAJIN tool telemetry, and no end-to-end Windows or GitHub publishing test has been performed yet. Real internal tool tracing needs additional instrumented event hooks and a separate privacy review.
