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

## 3. The two commands you actually need

```powershell
# day to day: check first, then start the loopback bridge
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Start

# remote mode (Arena is the planner, this PC is the executor): poll the relay forever
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\v6\start-arena-bridge.ps1 -Action Relay
```

`-Action Start` runs `arena doctor` first and **refuses to open the listener** if a
check is FAIL/BLOCKED. Everything else is a flag on the same script:

| Action | What it does |
| --- | --- |
| `Init` | creates policy, signing secret and bridge token (mode 600) |
| `Doctor [-Probe]` | real readiness check; `-Probe` performs a real relay write+read |
| `Start` | doctor, then `arena serve` on `127.0.0.1` |
| `Status` | policy, relay, queue and irreversible state |
| `Serve` | the loopback API only |
| `Poll` | one relay pass |
| `Relay` | continuous relay polling |
| `Watch` | live activity from the real event log |
| `Task -Kind K -Payload J` | enqueue one signed task locally |
| `InstallTask [-Apply]` | scheduled poller (dry run unless `-Apply`) |

Equivalent CLI: `majin-v6 arena init|doctor|status|task|poll|serve|watch`.

Loopback API (token at `<v6>/arena/bridge-token`):

```text
GET  /healthz        no auth, no payload
GET  /v1/status      real status report
GET  /v1/activity    live activity items + queue counts (cursor = last seq)
POST /v1/tasks       {kind, payload, title?, irreversible?}  -> 202 + durable task
GET  /v1/tasks/:id   state, progress, real result/output, receipt
POST /v1/stop        stop marker
```

## 4. What was verified here

### 4a. The GitHub 403 — root cause, measured

The first failure said "authentication failed", which was wrong and sent the
owner to the wrong place. Probing the actual token showed what it is:

| Probe | Result |
| --- | --- |
| `GET /repos/rssen-debug/majin2026` | **403** `Resource not accessible by integration` |
| Repositories the token can see | 5, all **public**; `majin2026` is not among them |
| Creating a repository / gist with that token | 403 — not permitted |
| The same call from Node | `UNABLE_TO_VERIFY_LEAF_SIGNATURE` until `NODE_EXTRA_CA_CERTS` points at the system CA bundle |

So it is a **scope** problem, not a credential problem: the token is valid but
`rssen-debug/majin2026` is not on its repository access list. `verifyPrivateRepo`
now reports `SYNC_TOKEN_SCOPE_DENIED` with the exact fix instead of
`SYNC_AUTH_FAILED`, and the doctor prints it as a BLOCKED check with the action:

> Fine-grained token → Repository access → select `rssen-debug/majin2026` →
> Permissions → **Contents: Read and write** → save to
> `<v6-home>/arena/github-token` → `-Action Doctor -Probe`.

`arena doctor --probe` then performs a real write, read-back and delete of
`arena/.probe/<id>.json`, which is what proves *both* sides can read and write.
That verification is **not done yet** — it needs the grant above.

### 4b. Execution through the bridge, live

Run against a fresh V6 home on this Linux host: `arena serve` on
`127.0.0.1:8899`, tasks posted as Arena would, executed by a real worker process
using the real V5 tool drivers.

| Step | Result |
| --- | --- |
| `POST /v1/tasks` `{tool:"fs_write"}` | 202, task queued |
| worker executes | `COMPLETED`, file on disk (36 B), receipt `v6-74815264…` |
| `POST /v1/tasks` `{tool:"re_hash"}` | `FAILED_FINAL` `TOOL_NOT_AUTHORIZED` — lane `re` not granted by the owner |
| after granting lane `re` | `COMPLETED`, and the reply carries `output.meta.hashes[0].sha256` |
| independent check `sha256sum` | `bdb115ad…87320fd` — **identical** |
| `browser.open` | 403 `TOOL_NOT_ALLOWED` (not in the owner's tool allowlist) |
| `shell_run` | 403 `TOOL_NOT_ALLOWED` |
| `job.submit` | 403 `KIND_NOT_ALLOWED` (irreversible work disabled) |
| `GET /v1/activity` | real event items + queue counts, cursor advanced |
| `arena watch --once` | prints the same lines from the same log |

This is a genuine round trip: Arena's request, MAJIN's queue, a real tool
execution, a real receipt and a result checked against the operating system.

### 4c. Tests

| Test | Status | What it proves |
| --- | --- | --- |
| `envelope.test.js` (8) | **PASS** | signing, tamper refusal, expiry/skew/TTL, kind+tool allowlists, irreversible gating, replay ledger, policy validation (clock is now fixed, so it cannot flake) |
| `bridge-server.test.js` (8) | **PASS** | loopback bind, 401, 421 on foreign Host, 202 task creation, 403 for unlisted kind/tool/irreversible, oversize, rate limit |
| `e2e-controlled.test.js` (4) | **PASS** | full chain over real sockets: discover → evaluate → approve → submit (one POST with CV) → receipt → confirmation → `CONFIRMED_RECEIVED`; replay sends nothing; unacknowledged answer → `UNCERTAIN` |
| `recovery.test.js` (1) | **PASS** | a worker **SIGKILLed** while the employer endpoint holds the request: exactly one submission ever left, state `UNCERTAIN`/`WORKER_LOST_IRREVERSIBLE`, effect marked uncertain, restarted worker executes nothing, `requeue` refuses, reconciliation never resends |
| `doctor-activity.test.js` (7) | **PASS** | doctor refuses to call an unconfigured bridge healthy; real relay probe over a socket; 403 mapped to a scope fix; sequence numbers unique across processes; `/v1/activity` auth + cursor; `watch` prints real lines |
| Real GitHub relay round trip | **BLOCKED** | the token cannot reach the private repo (see 4a) |
| Real Gmail | **BLOCKED** | no owner OAuth credentials |
| Real employer submission | **NOT_TESTED** | see §5 — needs an owner adapter and a real posting |
| Windows execution / scheduled task | **NOT_TESTED** | no PowerShell or Windows host in this environment |
| PowerShell script | **PASS (static only)** | brace/quote balance plus contract assertions in `launcher.test.js`; **never executed** |

## 5. The remaining step to a real application

On your Windows machine, in order:

1. `-Action Init` — creates the policy (irreversible work disabled).
2. Save the relay token (`<v6>/arena/github-token`) after granting the repo, then
   run `-Action Doctor -Probe` until every line is PASS.
3. Write `jobs/profiles.json` with your real CV path and candidate emails.
4. Author **one** adapter for **one** employer in `arena/adapters.json`
   (`type: http-post`, exact URL, field map, acknowledgement rule). Start with a
   staging/test form if the employer has one.
5. Enable deliberately: add `job.submit` to `allowedKinds`, set
   `allowIrreversible: true`, point `submission.adaptersFile` at that file, and
   re-run `-Action Doctor` (the submission check must turn PASS).
6. Run one submission and watch it happen:
   ```powershell
   .\scripts\v6\start-arena-bridge.ps1 -Action Task -Kind job.submit -Payload '{"applicationId":"<id>"}'
   .\scripts\v6\start-arena-bridge.ps1 -Action Watch
   node bin\majin-v6.mjs jobs list
   ```
7. Verify the acknowledgement in the portal and the confirmation email. Only
   then enable the scheduled poller (`-Action InstallTask -Apply`).

Until step 4 exists, `job.submit` answers
`SUBMISSION_ADAPTER_NOT_CONFIGURED` — by design, not by accident.

## 6. Honest limits of "Arena as the brain"

- **This chat cannot hold the signing key.** Arena's sandbox has no token for
  your private repo (403) and no route to your PC. A continuous
  "Arena-thinks-while-you-sleep" loop needs a key holder that runs outside the
  chat: GitHub Actions with the secret, your own scheduler, or a local client
  using the loopback API. Never paste the signing secret into a chat.
- **Arena sees sanitized results only.** The outbox carries state, receipt kind
  and reference, error codes — not CV contents or email bodies.
- **No shell.** There is deliberately no generic "run any command" envelope.
  The tool allowlist plus the owner lanes are the two gates in front of every
  call, and both refused live in §4b.
- **Browser, desktop and Gmail need the object they drive.** On this Linux host
  the inventory marks those tools unavailable for a real reason (no browser
  binary, Windows-only, no OAuth). On your Windows machine the tools exist but
  each lane still needs the owner grant, and Gmail needs your OAuth client.
- **Model choice is unchanged.** Nothing here calls OpenCode Go or any provider;
  `arena poll` performs zero inference.
