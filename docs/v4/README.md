# MAJIN V4 — quick start

Privacy-first mobile interface to the MAJIN installation already running on
your Windows PC. Your keys stay on the host; the phone only gets a session.

```bash
npm ci
npm run v4:doctor      # read-only host check
npm run v4             # start the host on 127.0.0.1:7373
npm run v4:pair -- --rotate   # new pairing code
npm run v4:test        # 111 tests
npm run v4:progress    # verified points, recomputed from the matrix
npm run v4:bench       # benchmark run, writes docs/v4/benchmarks/
npm run v4:plugins     # list installed/quarantined plugins
```

Open `http://127.0.0.1:7373` and enter the pairing code printed at boot.

- Public HTTPS + phone setup: `DEPLOYMENT.md`
- Architecture and reuse ledger: `ARCHITECTURE.md`
- Security model and gaps: `SECURITY.md`
- Source audit of V1/V2/V3: `SOURCE_AUDIT.md`
- Evidence behind every claim: `TEST_EVIDENCE.md` and `ACCEPTANCE_MATRIX.json`
- What is next: `NEXT_ACTIONS.md` · Platform rules: `PLATFORM.md`

**Status:** private vertical slice, **76.5/100 verified**, release NOT READY.
