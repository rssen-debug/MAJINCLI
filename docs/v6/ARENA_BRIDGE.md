# Arena ⇄ MAJIN bridge

Goal: **Arena plans, MAJIN executes.** Arena supplies the reasoning; the Windows
machine runs the tools, browser, job pipeline, Gmail reads and recovery. No
OpenCode Go quota is consumed by this path, and no second model runtime is
started.

This document starts with what was actually measured, because the honest answer
changes the architecture.

## 1. What Arena can actually connect to (investigated)

| Check | Result | Consequence |
| --- | --- | --- |
| Arena connector for this machine | `list_connector_tools("arena")` → **unsupported**; no Windows/host connector exists | Arena cannot dial the PC directly |
| Sandbox network egress | `api.github.com` → `200`; `example.com`, `ngrok.com` → TLS handshake killed | Only an allowlisted set of hosts is reachable; arbitrary internet is not |
| Inbound path to your PC | none — the sandbox is a separate Linux VM | A tunnel/home port is required for the reverse direction, which we deliberately avoid |
| Access to the private telemetry repo | `gh api repos/rssen-debug/majin2026` → **403** with the sandbox token | Arena's sandbox cannot read or write that private repo either |

**Conclusion:** a working bridge must be **outbound from your machine**. Two
transports are implemented, both authenticated:

1. **Relay** — Arena (or any planner) drops a signed envelope into a relay the PC
   polls. Implemented for a **private GitHub repository** and for **plain HTTP**.
2. **Loopback API** — for a planner running on the same PC. Binds `127.0.0.1`,
   bearer token, no CORS, host-header check.

Neither accepts unauthenticated input, and neither exposes a shell.

## 2. Security model

```
Arena / planner
      │  signs envelope (HMAC-SHA256, owner key, 15 min TTL, nonce)
      ▼
relay (private repo or HTTP)        ← carries envelopes + sanitized results only
      │  PC polls outbound (HTTPS)
      ▼
majin-v6 arena poll
      │  1. verify signature, key id, TTL, replay ledger
      │  2. check task kind + tool allowlist + irreversible flag
      │  3. enqueue durable task (dedupeKey = arena:<envelopeId>)
      │  4. acknowledge, execute, publish result
      ▼
existing V6 supervisor → existing MAJIN tools / job pipeline / Gmail
```

Guarantees enforced in code (all covered by tests):

- **Signature**: any changed byte breaks verification (`ARENA_BAD_SIGNATURE`).
- **Key**: only the configured `keyId` is accepted (`ARENA_UNKNOWN_KEY`).
- **Time**: expired, future-dated and >24 h envelopes are refused.
- **Replay**: an envelope id is consumed once; a second delivery is refused
  (`ARENA_REPLAY`) *and* the queue dedupe key prevents a second execution.
- **Capability**: only `allowedKinds`/`allowedTools` from your policy file.
  `shell_run` is not in the default allowlist and cannot be smuggled in.
- **Irreversible work** (`job.submit`): off by default; requires
  `allowIrreversible: true`, an explicitly irreversible envelope, and an
  owner-authored portal adapter.
- **`operationId`** cannot be injected through envelope arguments; MAJIN assigns
  it, so the driver's idempotency ledger stays authoritative.
- **Transport**: the relay token is separate from the signing secret; the bridge
  token is a third secret, shown to no one but the local client.
- **Output**: results are scrubbed before publication; a receipt that fails the
  privacy gate is withheld rather than uploaded.

Secrets live in `<v6>/arena/` with mode 600 (`secret`, `bridge-token`,
`github-token` if used). They are never committed, logged or sent to the relay.

## 3. Commands

```powershell
# one-time: create policy + secrets (no irreversible work enabled)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Init

# inspect the real policy/queue state
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Status

# local planner: authenticated loopback API
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Serve

# consume relay work once (or run continuously without --once)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Poll

# always-on: scheduled poller (dry run unless -Apply)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action InstallTask
```

Equivalent CLI:

```bash
node bin/majin-v6.mjs arena init [--repo owner/private] [--relay github|http]
node bin/majin-v6.mjs arena status [--json]
node bin/majin-v6.mjs arena task --kind KIND --payload JSON
node bin/majin-v6.mjs arena poll [--once] [--token-file PATH]
node bin/majin-v6.mjs arena serve [--port N]
```

Loopback API (token from `<v6>/arena/bridge-token`):

```text
GET  /healthz              no auth, no payload
GET  /v1/status            report
POST /v1/tasks             {kind, payload, title?, irreversible?}
GET  /v1/tasks/:id         task state/progress/receipt
POST /v1/stop              stop marker
```

## 4. What was verified here

| Test | Status | What it proves |
| --- | --- | --- |
| `test/v6/arena/envelope.test.js` (8) | **PASS** | signing, tamper refusal, expiry/skew/TTL, kind+tool allowlists, irreversible gating, replay ledger, size limit, policy validation |
| `test/v6/arena/bridge-server.test.js` (8) | **PASS** | loopback bind, 401 without token, 421 on foreign Host, 202 task creation, 403 for unlisted kind/tool/irreversible, 415/400/oversize handling, 429 rate limit |
| `test/v6/arena/e2e-controlled.test.js` (4) | **PASS** | real HTTP relay → signed envelope → durable queue → supervisor → job pipeline → multipart submission with CV → acknowledgement receipt → Gmail-shaped confirmation → `CONFIRMED_RECEIVED`; unacknowledged answer → `UNCERTAIN`; replay never resends; CLI poller in a real subprocess |
| Real GitHub relay | **BLOCKED** | sandbox token is rejected by the private repo (403); needs your token on your PC |
| Real Gmail | **BLOCKED** | no owner OAuth credentials |
| Real employer submission | **NOT_TESTED** | see below |
| Windows execution / scheduled task | **NOT_TESTED** | no Windows host or PowerShell available in this environment |
| Loopback bridge, executed for real | **PASS** | `arena serve` on `127.0.0.1:8899` with a fresh V6 home: `/healthz` → 200, `/v1/status` without token → 401, with token → the real status report, `Host: evil.example` → 421, `POST /v1/tasks {kind:"job.submit"}` → `KIND_NOT_ALLOWED`, `POST /v1/tasks {kind:"health.delay"}` → 202 with a durable task id |
| PowerShell script syntax and contract | **PASS (static only)** | `test/v6/launcher.test.js` asserts the dry-run switch, the `-Apply` gate, the refusal guards, quoted task arguments and that child output cannot corrupt the exit code; a tokenizer check confirms balanced quotes/braces. **It has never been executed.** |

### The end-to-end test, stated precisely

The controlled test uses **real** sockets, **real** signatures, the **real** V6
queue/supervisor, the **real** portal adapter and a **real** Gmail-shaped HTTP
API. The employer (`127.0.0.1`) and the mailbox are controlled endpoints on the
test machine.

It therefore proves: the machinery works end to end, a submission is only marked
submitted when an acknowledgement is observed, evidence is stored locally, and
replays cannot double-send.

It does **not** prove that a real company received an application. No real
application was submitted from this session, and none should be claimed.

## 5. The remaining step to a real application

On your Windows machine, in order:

1. `start-arena-bridge.ps1 -Action Init` — creates the policy.
2. Put a fine-grained GitHub token (contents: read/write on **your private**
   repo) or the HTTP relay token where `arena poll` can read it.
3. Write `jobs/profiles.json` with the real CV path and candidate emails.
4. Author **one** adapter for **one** employer in `arena/adapters.json`
   (`type: http-post`, exact URL, field map, ack rule). Start against the
   employer's staging/test form if they have one.
5. Enable deliberately: add `job.submit` to `allowedKinds`, set
   `allowIrreversible: true`, point `submission.adaptersFile` at that file.
6. Run a single submission:
   ```powershell
   .\scripts\v6\start-arena-bridge.ps1 -Action Task -Kind job.submit -Payload '{"applicationId":"<id>"}'
   .\scripts\v6\start-arena-bridge.ps1 -Action Poll
   node bin/majin-v6.mjs jobs list
   ```
7. Verify the portal acknowledgement and the confirmation email. Only then
   enable the scheduled poller.

Until step 4 exists, `job.submit` returns `SUBMISSION_ADAPTER_NOT_CONFIGURED` —
by design.

## 6. Honest limits of "Arena as the brain"

- **This chat session cannot host the writer.** Arena's sandbox has no token for
  your private repo (403) and no route to your PC. A continuous
  "Arena-thinks-while-you-sleep" loop needs a key holder that runs without this
  chat: a GitHub Actions workflow with the signing secret, your own automation,
  or the loopback API from a local Arena client. Do not paste the signing secret
  into a chat window.
- **Tokens are not exposed to the model.** Arena sees only the sanitized results
  you publish back, which is what the outbox contains: state, receipt kind and
  reference, error codes.
- **No shell.** There is deliberately no generic "run any command" envelope.
  Adding one would turn a signed task queue into a remote shell.
- **Model choice is unchanged.** Nothing here calls OpenCode Go or any provider;
  `arena poll` performs zero inference.
