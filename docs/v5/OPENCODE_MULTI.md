# MAJIN OpenCode Multi (experimental)

A separate non-interactive task launcher that reuses the **installed OpenCode CLI** and its selected model (including an already configured DeepSeek model). It does not replace the interactive `opencode` terminal.

- Start an independent task: `node scripts/v5/opencode-multi.mjs start "Review the job dashboard (do not submit applications)"`
- Long prompts: `node scripts/v5/opencode-multi.mjs from-file "C:\\Temp\\my-task.txt"`
- Add a persistent owner correction: `node scripts/v5/opencode-multi.mjs remember "Do not apply to firstline jobs"`
- List jobs: `node scripts/v5/opencode-multi.mjs status`
- Read output: `node scripts/v5/opencode-multi.mjs log <task-id>`
- Send additional independent work: run `start` again while another task runs.
- Continue via a **new task** with prior context: `node scripts/v5/opencode-multi.mjs followup <task-id> "Check the confirmation email"`.

**Limitations:** Parallel tasks are separate `opencode run` calls, not simultaneous interactive chat with the same session. `followup` creates a new task and DOES NOT inject text into a currently running model turn. Status comes from the local child process only; it does not prove job applications were received. Tasks may collide when writing the same files or browsing shared state; use separate workspaces/worktrees for overlapping development jobs. No automatic task cancellation or concurrency cap has been implemented yet. Long requests passed as a single Windows command-line argument may hit OS limits: use `from-file` for prompt text, but the worker still passes it as a CLI argument. The child runner requires OpenCode installed and in PATH.

Records, output, and owner corrections stay in `%LOCALAPPDATA%\\MAJIN\\opencode-multi`, not in GitHub. Avoid putting tokens, verification URLs, CV contents or email details in prompts and log output. The process may die without updating its status on power loss. This change does NOT implement Gmail OAuth, job-portal verification, self-modifying code, or GitHub debug uploads. Future work should integrate into V5 provider-agent and use OpenCode's server/session API for true steering and robust multi-agent control.
