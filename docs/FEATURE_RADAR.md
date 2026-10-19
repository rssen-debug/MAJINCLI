# MAJIN FEATURE RADAR — top 5 discoveries (2026-10-19 night, after Del 7B+7C)

Standing rule from the master brief: every run records its five highest-value
discoveries in docs. Each item names where it was found and why it ranks.
Nothing here is scored — only listed by observed point-density and leverage.

1. **Del 7D harness is now one module away (2p, last Skill Compiler gap).**
   Found while shipping 7B: adapters are validated descriptors on disk with a
   permission class. The only missing piece for "new capability through the
   whole engine" is a tiny executor that (a) fetches `baseUrl` (GET for `read`),
   (b) applies the dotted-path mapping, (c) enforces `rate.maxPerHour` on disk,
   (d) routes `external-write`/`external-post` through the approvals gate — and
   (e) records a `skill outcome` (7C) per call so bad adapters disable
   themselves. All four ingredients shipped tonight; 7D is assembly + tests.

2. **Registry-count pins are intentional tripwires — but they cost a sweep.**
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
