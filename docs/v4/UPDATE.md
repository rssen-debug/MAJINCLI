# MAJIN V4 — updates without PowerShell

The requirement: approved releases install and activate without the owner opening a terminal again.
That is only safe if an update is provably the release the owner approved. This is how.

## The chain

```
you approve a release
        │
release tool  ── signs manifest.json with the private key ──┐
        │                                                   │
GitHub release assets:  manifest.json, manifest.sig, files/ │
        │                                                   │
host:  v4:update apply                                      │
        ├─ verify the signature with the PINNED public key ─┘
        ├─ hash every file before writing it       (a bad byte never lands)
        ├─ stage beside the live tree
        ├─ swap with two renames                   (no half-installed state)
        ├─ restart the host through the supervisor
        ├─ health check
        └─ if unhealthy: restore the previous tree, restart, report ROLLED_BACK
```

## One-time setup (the only terminal step, once)

```powershell
cd C:\MAJINCLI
git pull
npm ci
npm run v4:setup -- --autostart
```

That command does everything it can do alone, prints the pairing code **once**, seeds Owner Mode
with the read-only network lanes, and registers the per-user logon task. It also prints exactly
what it could not do (tunnel, provider key, release key) with the one action each needs.

To enable verified updates, put the **public** half of the release key at
`release-public-key.pem` in the checkout before running setup. Without it, `v4:update` refuses to
trust any release — by design.

## Publishing a release (you or a trusted machine)

```bash
# private key stays on the machine that builds
node scripts/v4/release.mjs --key ~/majin-release.pem
# -> dist/release/manifest.json, manifest.sig, files/, public-key.pem
```

Upload those as release assets, then point the host at them once:

```powershell
setx MAJIN_V4_RELEASE_URL "https://github.com/rssen-debug/MAJINCLI/releases/download/v4.0.1"
```

## Applying

```powershell
npm run v4:update check     # what is available, changes nothing
npm run v4:update apply     # verify, stage, activate, restart, health check
```

Windows Task Scheduler can run `check` on a schedule; `apply` is the deliberate step, or wire it
to the supervisor later. Neither one needs a new PowerShell session from you.

## What is refused

| Situation | Result |
|---|---|
| signature does not match the pinned key | `BAD_SIGNATURE`, nothing staged |
| no key pinned and `--allow-unsigned` not given | `NO_KEY`, refused |
| a file's bytes do not match the manifest | `HASH_MISMATCH`, nothing written |
| the release is older than what runs | `DOWNGRADE_REFUSED` |
| the same version | `NOOP` |
| the new version fails its health check | automatic rollback, previous tree restored |
| no previous tree to roll back to | `FAILED`, stated plainly |

## Not built, and why

A **scheduled** applier (run `apply` from Task Scheduler automatically) is not wired. The pieces are
tested, but turning it on means one unanswered question: should an unattended Windows box install a
signed release at 03:00 with nobody watching? Rollback covers a bad build; it does not cover a
release that is signed but wrong for this machine. That decision is the owner's, so the default is
`check` on a schedule and `apply` on a human word.
