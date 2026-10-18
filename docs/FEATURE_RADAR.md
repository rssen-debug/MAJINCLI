# MAJIN FEATURE RADAR — top 5 discoveries (2026-10-18, refreshed after Del 4A)

Standing rule from the master brief: every run records its five highest-value
discoveries in docs. Each item below names where it was found and why it ranks.
Nothing here is scored — only listed by observed point-density and leverage.

1. **Del 4C — hard execution caps (retry / budget / timeout / approval).** Found in
   `docs/COMPLETION_MATRIX.md` (4C UNVERIFIED): swarm timeouts and agent step caps
   exist in `src/core/swarm.js`, but there is no budget cap and no acceptance test
   proving a hard stop. An obvious token budget already flows through bench
   counters (`scripts/bench.mjs` prints tokens/run), so a `mission.budget` cap with
   a fail-hard test is the next cheap 4 points. Point-density rank: #1.

2. **Machine-readable verification receipts.** Found in `src/core/mission.js`
   (Del 4A): provenance strings (`[VERIFIED: store/ has 3 files (independently
   counted), after repair]`) are today text-only inside `textSummary`. Emitting the
   same records as `<sid>.receipts.jsonl` would feed two deferred phases at once:
   Del 4D (cross-domain independent checks need a standard evidence record) and the
   future UI "receipts" view (Del 8) — one file, two phases unlocked.

3. **Contract types beyond files: `command_exits_zero` and `json_against_schema`.**
   Found while scoping Del 4A's `buildContracts`: the engine's contract registry is
   one switch away from two more types. `command_exits_zero` covers "the script ran
   successfully" claims (verifiable in code, never by model), `json_against_schema`
   covers structured-output tasks. Both are direct groundwork for Del 4D (real
   cross-domain tasks with independently checked results, currently 1 domain).

4. **Consolidate the two verification engines.** Found in `src/core/mission.js`:
   `verifyClaimedArtifact` (legacy single-file path) and `verifyContract`
   (contract engine) now coexist, and `verifyContractLegacy` is the glue. Once all
   briefs produce contracts, the legacy path is dead code. One reality engine means
   one sabotage surface, one discrimination test set, one set of evidence semantics.
   Ranked lower than 1–3 because it earns correctness, not acceptance points — but
   it should land before Del 4D multiplies contract types.

5. **Del 2C — clarify + replan on contract death.** Found at the intersection of
   Del 2 (Grand Architect) and Del 4A: when a contract dies and repair also fails,
   today the part fails. The Grand Architect could instead REPLAN the DAG around
   the dead contract (different node order, different tool decomposition) before
   reporting failure. This turns Del 2C from "clarify before starting" into
   "clarify/replan mid-flight" — worth 3 points and it reuses the repair loop's
   dead-contract list as the replan trigger.

Historical context: previous radar rounds produced the github.research tool
(see `docs/GITHUB_RESEARCH.md`) — that pipeline remains the delivery channel for
ecosystem discoveries; this file tracks in-repo discoveries.
