# MAJIN V5 job application guard

The job application gate in `src/v5/job-application-guard.js` is a reusable **policy module**. It requires an immutable job ID or canonical URL, blocks employers (Atea, Gigstep, Poolia), honors owner-excluded jobs, prevents repeats and requires explicit per-job approval before any submit action. It also refuses to mark an unconfirmed application as accepted based on weak UI signals.

**Integration required:** OpenCode-generated local files `jobs-dashboard/submit_applications.py`, `submit_nxt.py` etc. are not part of repository `main`. This guard will not automatically intercept those Python scripts. Import and call this gate at the actual V5 submission adapter and ensure generated Python automation uses equivalent checks before clicking 'Submit'. Persist approvals, exclusions and receipts outside GitHub in owner-local storage; reconcile local submissions before another attempt. Set individual approval false by default.

A 'thank you' page is a candidate proof, not necessarily that the email is fully verified. Save separate receipts and states. Do not embed tokens, private verification URLs, passwords, CVs or email content in GitHub.

Run: `node --test test/v5/job-application-guard.test.js`.

Follow-up needed: integration, Windows E2E, Gmail access via authorized OAuth, durable receipt storage, and sanitized debug reports. No claim of autonomous learning or fully operational Gmail from this change alone.
