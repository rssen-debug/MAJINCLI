# MAJIN V6 Job Hunter

The Job Hunter is a durable, time-bounded supervisor. It uses the existing V6
queue, worker, supervisor, checkpoints and job store. It does not create a
second queue and it does not reset the clock when a worker batch ends.

## Commands

```powershell
node bin/majin-v6.mjs jobhunt 30m
node bin/majin-v6.mjs jobhunt 60m
node bin/majin-v6.mjs jobhunt 120m
node bin/majin-v6.mjs jobhunt 320m
node bin/majin-v6.mjs jobhunt 10000m
node bin/majin-v6.mjs jobhunt 2h
node bin/majin-v6.mjs jobhunt 1d
node bin/majin-v6.mjs jobhunt status
node bin/majin-v6.mjs jobhunt pause
node bin/majin-v6.mjs jobhunt resume
node bin/majin-v6.mjs jobhunt stop
node bin/majin-v6.mjs jobhunt report
```

The OpenCode command has the same surface:

```text
/jobhunt 120m
/jobhunt status
/jobhunt pause
/jobhunt resume
/jobhunt stop
/jobhunt report
```

## Time semantics

- `m`, `h` and `d` are supported, including compound values such as `1d2h30m`.
- `startedAt` and `deadlineAt` are absolute ISO timestamps.
- A worker restart reads the same `deadlineAt`; it never starts a new full duration.
- A worker batch ending only ends that batch. The runner plans and continues while
  the deadline has not passed.
- No new task is planned after the deadline. A task that is already running may
  finish. The partial/final report then records the actual result.
- Pause stops new work but preserves the original deadline. Resume continues
  within that same deadline.
- `stop` writes a stop marker, allows the current task to finish safely, and
  writes a partial report.

## Pipeline

The runner plans work in this order:

1. `job.evaluate` for discovered applications.
2. `job.submit` only for approved applications, with an irreversible effect key.
3. `gmail.verify` for submitted but unconfirmed applications.
4. New `job.discover` rounds when no eligible work remains.

The queue's `dedupeKey`, `effectKey`, leases and effect ledger prevent a second
worker from executing the same submission.

## Safety boundaries

- A discovered row is not an application.
- A click or HTTP 200 is not a receipt.
- `VERIFIED` requires a portal confirmation reference or a matched confirmation
  email.
- `EMAIL_VERIFICATION_PENDING` is not `CONFIRMED_RECEIVED`.
- Login, MFA and CAPTCHA are returned as `BLOCKED`; they are never bypassed.
- Submission remains blocked until an owner-authorized `job.submit` adapter is
  configured. Discovery, matching and verification still run.
- Gmail is read-only. Verification links are not followed.
- No credentials, tokens or secret values are written into session or report
  files.

## State and reports

V6 home layout:

```text
<jobhunt-home>/
  jobhunt/session.json
  jobhunt/STOP
  reports/jobhunt-<session>-<timestamp>.html
  reports/jobhunt-<session>-<timestamp>.xlsx
  workers/jobhunt-<session>.json
```

The session file stores status, absolute deadline, elapsed/remaining time,
candidate, query rounds, runner PID, checkpoint counts and report paths. Reports
are generated from persisted queue/job state, not from model claims.

## Model policy

DeepSeek Flash is the default. The Job Hunter does not invoke a Pro model. The
existing model router must be separately deployed and verified before any Pro
fallback is credible.

## Verification

```powershell
node --test test/v6/jobhunt-duration.test.js
node --test test/v6/jobhunt-session.test.js
node --test test/v6/jobhunt-runner.test.js
node --test test/v6/jobhunt-cli.test.js
```

The tests use simulated time for `120m`, `320m` and `10000m` so multi-day
durations do not require real days of testing.

## DeepSeek Flash Head Orchestrator

The mission runner calls a real DeepSeek Flash decision point through the
installed `opencode run` CLI. It does not use a mock in production.

The call is recorded in `jobhunt/ai.jsonl` with:

- `missionId`
- `invocationId`
- `provider` (`opencode-go`)
- `exactModelId`
- `opencodeSessionId`
- `createdAt` / `completedAt`
- `messageText` and `strategy`
- proposed tasks and usage

A real call must complete before a message is shown in the dashboard. A failed
call is recorded as `FAILED`; the runner falls back to deterministic discovery
and keeps checking until the deadline. The AI is not called in a tight loop:
there is a minimum backoff, a per-mission call cap, and a dedupe key for every
proposed task.

Allowed AI tasks are bounded: `job.discover`, `job.evaluate` and
`gmail.verify`. The head cannot bypass owner review or create a submission.

## Empty-queue recovery

`engine.stopped` from the worker only means the current batch ended. It is not
mission completion. When the queue is empty before the deadline the runner:

1. reads the mission/session and remaining deadline;
2. checks the AI backoff and call cap;
3. asks the head for the next bounded tasks;
4. enqueues only valid tasks with dedupe keys;
5. falls back to bounded discovery when the head returns no usable task;
6. starts another worker batch and repeats until the deadline.

The mission is `EXPIRED` only at the absolute deadline, or `STOPPED`/`FAILED`
only for an explicit owner stop or a recorded failure.

## Dashboard

The dashboard reads `jobhunt/ai-active.json` and `jobhunt/ai.jsonl` and shows
real AI status (`THINKING`, `IDLE`, `BLOCKED`, `WAITING`), the latest message,
strategy, invocation ID, OpenCode session, exact model and call count. Worker
batch events are labelled as batches, not mission completion.

## Windows state writes

`atomicWriteJson` retries transient Windows `EPERM`/`EACCES`/`EBUSY` rename
errors before falling back to a complete copy. A transient antivirus/indexer
lock must not turn a live mission into a false `FAILED` session.

## Guarded submission and quota outages

Use `majin-v6 jobhunt 40m --candidate lavinia --no-ai` while the configured
provider is unavailable. The session persists the no-AI decision so a detached
worker or resumed session cannot enable provider calls. This does not approve
applications or configure an alternative paid provider.

Submission requires a candidate-matched APPROVED record with an approval
reference, browser grants, a readable prior-application ledger, verified CV
attachment and valid required fields. An intent is written before the final
click. A missing receipt leaves UNCERTAIN and must be reconciled, never retried
automatically. Search-only matches remain subject to owner review.

The browser checks and adapter tests are not proof that an employer received an
application. Keep live receipts separate from simulated test results.
