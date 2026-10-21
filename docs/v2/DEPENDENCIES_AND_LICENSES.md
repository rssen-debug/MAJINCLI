# V2 DEPENDENCIES AND LICENSES (PHASE 2/1 decision pass, 2026-10-21)

Decision policy (prompt §98): research mature, document why, pin, minimal footprint.
Repo philosophy measured: ONE runtime dep today (chokidar). Every new dep must earn its place.

## Adopted

| Component | Choice | License | Why this one (evidence 2026-10-21) | Footprint |
|---|---|---|---|---|
| Scheduler concurrency | **p-queue** (sindresorhus) | MIT | 4.3k stars, ~30M weekly npm downloads, v10.0.0 released within days, two tiny deps (eventemitter3, p-timeout), ESM, Node>=20. Mean-reversion alternative = hand-rolled concurrency with subtle race risk (the exact spot agents get wrong). | +1 dep (~100 KB bundled) |

## Evaluated and deferred / rejected (with reasons)

| Area | Candidate | Verdict | Evidence |
|---|---|---|---|
| Persistence engine | node:sqlite (builtin) | DEFER | Available flag-free since Node 22.13, experimental warning on 22, RC 1.2 on 24/25.7. Choose at V2-alpha packaging when Node floor is lifted to >=22.13 officially; kernel receipts stay JSON-file based until then (works, tested). |
| Persistence engine | better-sqlite3 (WiseLibs) | REJECT (for now) | Production-proven MIT, but native addon -> must ship .node inside the pkg/esbuild exe bundle; high packaging risk for zero current gain (JSON receipts suffice for kernel stage). Revisit with node:sqlite. |
| Event bus | node:events (builtin) | CHOSEN (zero-dep) | Events need only typed pub/sub in-process; adding mitt/eventemitter buys nothing we don't already have. |
| Graph topology helpers | toposort & friends | REJECT | topo order + cycle detection is ~40 tested lines maintained internally (dag.js); external microlibs add supply-chain surface without meaning. |
| State machines full | xstate v5 | REJECT (stage) | Powerful but heavyweight for what brief 3.4 requires (12 states, explicit transition table already exists and is 60 lines, tested). Revisit if UI-side visual editing of flows becomes a requirement. |

## Policy from here

- Pin every adopted dep in package-lock.json (CI npm ci enforces). One dep reviewed at a time.
- Licence sheet regenerated at V2-alpha packaging against the real lockfile.
