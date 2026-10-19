# MAJIN FEATURE RADAR — top 5 discoveries (2026-10-19 evening, wave 4: 3E LIVE — Del 3 COMPLETE 10/10)

Standing rule from the master brief: every run records its five highest-value
discoveries in docs. Each item names where it was found and why it ranks.
Nothing here is scored — only listed by observed point-density and leverage.

1. **SHIPPED — Del 3E REAL benchmark (2p): HYPERSWARM COMPLETE 10/10.** The
   opencode key (free models only, longcat-2.5-preview-free) landed and the
   harness ran same-night: 4.29× median speedup, overlap 0 vs 6/6, 24/24 ok,
   6 290 tokens measured. Live path is now ORDINARY infra: any remaining
   "needs live key" row (1E, 6C) lost its last decoy excuse — they are
   next-wave candidates, not blockers.

2. **NEW — Silent no-op doc edits are the most expensive cheap bug.** Found shipping 7D+9D/10C: two DECISIONS entries never landed because a `replace()` anchor ('# DECISIONS') did not match the real heading ('# Decisions') — the failure was silent and invisible to the suite until re-verified manually. Rule now: every docs edit asserts `count==1` AND is grep-verified post-write; a docs trio isn't done until the target lines are re-read from disk. Rank: #2 because it guards the whole evidence chain.
   Found while shipping 7B: `103` was hardcoded in 5 test files (agent, jobs,
   server, subset, capability). Adding one tool red-lighted 4 suites. This is
   GOOD design (it forces every new tool through review), but the pins should
   read from one canonical count (e.g. `tools/index.js toolCount()`) with only
   ONE literal per repo. Rank: #2 (test hygiene, prevents future friction).

3. **Skill outcomes are telemetry the agent already knows how to use.**
   Found in `src/core/agent.js:425` (skills are saved after good runs): the
   auto-save path could attach outcome history to `delegated` sub-tasks
   (prefer skills with `streak >= 3`, avoid `fails >= 1`). One filter in
   `match()` ordering turns 7C's honest bookkeeping into visibly smarter task
   routing — groundwork for Del 8's "how good is MAJIN at doing X" view.

4. **Permission classes can reuse the jobs.send approval proof.**
   Found in `test/jobs.test.js` (`jobs.send` risk `destructive` => per-send
   approval — already proven): `external-post` adapters intend exactly that UX.
   The 7D executor can mount adapters into the same approvals surface instead
   of inventing a second gate, inheriting per-instance evidence and tests.

5. **`skills.maxInPrompt` silently truncates at 12 skills — worth surfacing.**
   Found reading `Skills.prompt()`: with growth past 12 skills, saved skills
   fall out of the system prompt with no signal. A one-line `skill.pruned`
   bus event when truncation happens would make prompt composition honest —
   cheap, and directly useful when skills becomes the agent's main long-term
   memory (Del 7 makes that likely).
