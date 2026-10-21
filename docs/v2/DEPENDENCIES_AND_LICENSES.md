# V2 DEPENDENCIES AND LICENSES (PHASE 2/1 decision pass, 2026-10-21)

Decision policy (prompt §98): research mature, document why, pin, minimal footprint.
Repo philosophy measured: ONE runtime dep today (chokidar). Every new dep must earn its place.

## Adopted

| Component | Choice | License | Why this one (evidence 2026-10-21) | Footprint |
|---|---|---|---|---|
| Scheduler concurrency | **p-queue** (sindresorhus) | MIT | 4.3k stars, ~30M weekly npm downloads, v10.0.0 released within days, two tiny deps (eventemitter3, p-timeout), ESM, Node>=20. Mean-reversion alternative = hand-rolled concurrency with subtle race risk (the exact spot agents get wrong). | +1 dep (~100 KB bundled) |
| PNG encode/decode (pixel verifier) | **pngjs** @7.0.0 (lukeapage) | MIT | 57M+ weekly npm downloads, 2,229 dependent packages, pure JS, encodes and decodes (tests generate own fixtures). Maintenance flag "inactive" (no release since 2023) — ACCEPTED risk because PNG is a static spec with completion; no vulnerabilities reported. | +1 dep, zero sub-deps |
| DOM verifier | **playwright** (already in repo as devDependency) | Apache-2.0 | Reuse, do not re-adopt: verifier degrades honestly to DEPENDENCY_MISSING when not installed, so production bundle unaffected. | none (optional capability) |

## Evaluated and deferred / rejected (with reasons)

| Area | Candidate | Verdict | Evidence |
|---|---|---|---|
| Persistence engine | node:sqlite (builtin) | DEFER | Available flag-free since Node 22.13, experimental warning on 22, RC 1.2 on 24/25.7. Choose at V2-alpha packaging when Node floor is lifted to >=22.13 officially; kernel receipts stay JSON-file based until then (works, tested). |
| Persistence engine | better-sqlite3 (WiseLibs) | REJECT (for now) | Production-proven MIT, but native addon -> must ship .node inside the pkg/esbuild exe bundle; high packaging risk for zero current gain (JSON receipts suffice for kernel stage). Revisit with node:sqlite. |
| Event bus | node:events (builtin) | CHOSEN (zero-dep) | Events need only typed pub/sub in-process; adding mitt/eventemitter buys nothing we don't already have. |
| Graph topology helpers | toposort & friends | REJECT | topo order + cycle detection is ~40 tested lines maintained internally (dag.js); external microlibs add supply-chain surface without meaning. |
| State machines full | xstate v5 | REJECT (stage) | Powerful but heavyweight for what brief 3.4 requires (12 states, explicit transition table already exists and is 60 lines, tested). Revisit if UI-side visual editing of flows becomes a requirement. |

| LLM-agent eval harness (model benchmarks only) | **promptfoo** | MIT | Deferred to model-benchmarking milestone (brief section 84): ~25.7k stars, Node-native, red-teaming. Acquisition risk noted (OpenAI acquired it March 2026; stays open source on record). NOT for GAUNTLET: it grades model outputs, while MAJIN GAUNTLET must prove end-to-end execution evidence on this repo's own kernel. |
| Prompt evaluation (legacy) | openai/evals | MIT | REJECT: hosted product is being shut down (announced June 2026, fully off Nov 30 2026). |

## Policy from here

- Pin every adopted dep in package-lock.json (CI npm ci enforces). One dep reviewed at a time.
- Licence sheet regenerated at V2-alpha packaging against the real lockfile.
