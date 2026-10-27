# V5 safe restart + private-only debug overview (Windows)

This is a non-destructive alternative to **start-full-cli.ps1**. It NEVER runs git pull,
npm ci, grants, model selection, automatic resume or an untrusted remote command.

## Start once from an existing checked-out branch

From the repository directory in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .scripts5start-safe-with-private-debug.ps1 -CliRoot "C:MAJINCLI"
```

If the V5 installation is elsewhere, replace `C:MAJINCLI` with its real folder.
If V5 data is in a custom location, add `-DataDir "C:actual5"`.
The launcher refuses to create a missing profile, avoids starting a duplicate
MAJIN process, and preserves existing checkpoints. It starts an interactive
V5 chat; use `/status`, `/checkpoint`, `/logs`, `/resume` and `/exit`.
It **does not** automatically resume uncertain job submissions.

For inspection without running MAJIN:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .scripts5start-safe-with-private-debug.ps1 -CliRoot "C:MAJINCLI" -InspectOnly
```

For a local-only observer use `-NoPrivateDebug`.
The private upload target defaults to `rssen-debug/majin2026`. It must be
accessible as a **private** repository to the locally authenticated GitHub CLI
(`gh auth status`). Switch the repository with `-PrivateDebugRepo owner/private-repo`.

## What gets captured

The observer watches the checkpoint in `%LOCALAPPDATA%MAJIN5provider-agentcurrent.json`.
Each snapshot creates *allowlisted* `private-debug/overview.json` and
`private-debug/OVERVIEW.md` on the same local data profile. If configured,
it updates `debug/majin-v5/latest.json` and `debug/majin-v5/OVERVIEW.md`
**inside the private repository only**, after verifying that its GitHub API
visibility is private. The report includes goal status, resumptions, tool names,
tool results as boolean success/failure, error codes, verification counts,
model-call counts, and the latest 120 *observable* execution events.

Not uploaded: goal instructions, model prose or private chain of thought,
full tool arguments/results, CV data, applicant identity, emails, URLs, cookies,
tokens, environment variables, local paths or remote-command contents.
The original checkpoint and detailed `/logs` stay on the machine.
This cannot capture every internal decision, only host-observable actions.
It cannot retroactively observe events absent from checkpoints.

Uploads retry on the next polling cycle after an error. The observer never
grants access, submits job applications, restarts a job or changes the model.
It does **not** activate the older `DEBUGGER.md` bridge's remote
`Invoke-Expression` / `.remote/command.json` loop; that mechanism is unsafe.

## Tests

```powershell
node --test test/v5/private-debug-overview.test.js
```

The unit tests verify that sample CV paths, email addresses, secrets,
prompt contents and untrusted event fields are absent from the remote report.
Windows + GitHub CLI upload acceptance is **not verified** by unit tests.
A full live Windows launch and private GitHub publish must be verified
before declaring production-ready. Do not merge on the strength of registered
tools alone.
