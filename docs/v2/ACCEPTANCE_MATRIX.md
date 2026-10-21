# acceptance matrix

> Scaffold created 2026-10-21 during PHASE 0 isolation. Per-capability VERIFIED/PARTIAL/BROKEN/NOT_TESTED/NOT_IMPLEMENTED with evidence links. Seeded by BASELINE_AUDIT section 6, completed at end of PHASE 1.

## Working rows (updated continuously during V2 development)

| Capability | Classification | Evidence |
|---|---|---|
| Durable goal state machine + receipts (V2 kernel) | VERIFIED | test/v2-goal-runtime.test.js 8/8 local; CI v2-fast-ci on branch v2/agent-runtime |
| V1 full test suite baseline | VERIFIED | 930/0/17 on v2/main at ff46586+; CI run 39674378385 SUCCESS |
| Windows interactive desktop lane | PARTIAL | V1 evidence (runs 39588560481/39586059993); must rerun against 2.0.0-alpha on runner -> planned |
| Compiler/DAG/scheduler | NOT_IMPLEMENTED | snapshot docs/v2/ARCHITECTURE.md sec.3 |
| Verifier registry (file/http/pixel + dom-capability) | VERIFIED | test/v2-verifiers-events.test.js 8/8; pixel proof uses real PNG fixtures written via pngjs; dom degrades honestly |
| Typed event bus (brief 108) | VERIFIED | ring-buffer audit + listener isolation asserted; node:events zero-dep decision |
| MAJIN GAUNTLET (deterministic scenarios G1-G5) | VERIFIED | 5/5 pass local + in CI step; verified 100%, false success 0; blocking scenario ends FAILED with deploy never executed |
| Memory store (8 kinds, retention, search, export/clear) | VERIFIED | test/v2-memory-context.test.js 7/7; sensitive-refusal enforced |
| Context engine (budget packing, essentials survive, honest truncation) | VERIFIED | same file; 4-char/token estimator documented as conservative |
| Goal compiler (deterministic + model-adapter, zod-guarded) | VERIFIED | test/v2-compiler-supervisor.test.js 6/6 incl. inference flags + fuzzed model output rejection; never silent-repairs intent |
| Supervisor (goal -> role-tagged DAG) | VERIFIED | same file: dependency gating + parallel-build spawn + verifier-per-acceptance + end-to-end completion refusal until proof |
| Command preflight tiers (ok/hold/no + bypass vectors) | VERIFIED | test/v2-safety-recovery.test.js 8/8 incl. flag-reorder, bash -c unwrap, interpreter payload, scoped destructive -> hold |
| Consent/session layers 53-58 | VERIFIED | same file: exact-scope match, one-time use counts, ttl expiry, revocation, no self-consent, audit events |
| Recovery advisor (bounded per-class plans) | VERIFIED | same file: all 19 classes bounded, budget exhaustion exact, USER_ACTION_REQUIRED never loops |
