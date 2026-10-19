# MAJIN FEATURE RADAR — top 5 discoveries (2026-10-19 late evening, after Del 2C)

Standing rule from the master brief: every run records its five highest-value
discoveries in docs. Each item below names where it was found and why it ranks.
Nothing here is scored — only listed by observed point-density and leverage.

1. **Del 3E — REAL parallel-vs-sequential benchmark (2p, last HYPERSWARM gap).**
   Found while shipping 3C/3D: the scheduler now has OBSERVABLE recovery
   (worker_retry events), bounded attempts and honest blocked states — the only
   missing evidence is a live-model measurement. Needs one live provider key;
   harness pattern is proven (timed streams + call counters), so with a key the
   benchmark is a one-evening PR: N independent briefs × parallel(cap=N) vs
   sequential(cap=1), median wall time + tokens, ≥3 runs. Point-density rank: #1
   when a key exists, otherwise unbuildable.

2. **Machine-readable verification receipts.** Found in `src/core/mission.js`
   (Del 4A): provenance strings (`[VERIFIED: store/ has 3 files (independently
   counted), after repair]`) are today text-only inside `textSummary`. Emitting
   the same records as `<sid>.receipts.jsonl` would feed two deferred phases at
   once: Del 4D (cross-domain independent checks need a standard evidence
   record) and the future UI "receipts" view (Del 8) — one file, two phases
   unlocked. Rank: #2.

3. **Contract types beyond files: `command_exits_zero` and `json_against_schema`.**
   Found while scoping Del 4A's `buildContracts`: the engine's contract registry
   is one switch away from two more types. `command_exits_zero` covers "the
   script ran successfully" claims (verifiable in code, never by model),
   `json_against_schema` covers structured-output tasks. Both are direct
   groundwork for Del 4D (real cross-domain tasks with independently checked
   results, currently 1 domain). Rank: #3.

4. **Consolidate the two verification engines.** Found in `src/core/mission.js`:
   `verifyClaimedArtifact` (legacy single-file path) and `verifyContract`
   (contract engine) now coexist, and `verifyContractLegacy` is the glue. Once
   all briefs produce contracts, the legacy path is dead code. One reality
   engine means one sabotage surface, one discrimination test set, one set of
   evidence semantics. Earns correctness, not acceptance points — but it should
   land before Del 4D multiplies contract types. Rank: #4.

5. **Loop observability: unify `error`, `worker_retry` and `mission_limit` into one event taxonomy.**
   Found while wiring Del 3C/2C: recovery surface now emits `error` (loop),
   `worker_retry` (swarm), `mission_limit` / `mission_clarify` / `mission_replan`
   (mission) from three layers with three shapes. Del 8's Live Agent
   Visualization will need ONE documented event vocabulary — a small
   `docs/EVENTS.md` contract + shape assertions in `test/mission.test.js` —
   before the UI agent builds on sand. Earns integration quality, not matrix
   points. Rank: #5.

Historical channel: ecosystem discoveries flow through the built-in
github.research tool (see `docs/GITHUB_RESEARCH.md`); this file tracks
in-repo discoveries.
