---
description: Start or control the MAJIN V6 Job Hunter with an absolute duration.
agent: build
---

The owner invoked `/jobhunt $ARGUMENTS`.

Run the real MAJIN V6 command from the repository root:

```powershell
node bin/majin-v6.mjs jobhunt $ARGUMENTS
```

Rules:

- A duration is required to start: `30m`, `60m`, `120m`, `320m`, `2h`, `1d` or a compound such as `1d2h30m`.
- `status`, `pause`, `resume`, `stop` and `report` are control commands.
- Never claim that work is running unless the command reports a live worker PID or `jobhunt status` shows `Worker: ACTIVE`.
- Report the real absolute deadline, remaining time, queue counts, job counts and report paths.
- Do not bypass login, MFA or CAPTCHA. Report those as `BLOCKED`.
- Do not describe a database row as a submitted application. Only a real receipt makes an application `VERIFIED`.
