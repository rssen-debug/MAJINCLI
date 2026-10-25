# Benchmarks

```bash
node scripts/bench.mjs                # table + verdict
node scripts/bench.mjs --turns=5      # percentiles over repeats
node scripts/bench.mjs --json         # machine-readable (CI-friendly, exit 1 on any failure)
node scripts/bench.mjs --scenario=re  # one scenario
MAJIN_BENCH_KEEP=1 node scripts/bench.mjs   # keep the temp home to inspect
```

## What it measures — and what it does not

The harness runs **real turns** through `Agent.turn()`: intent parse, job routing, the tool loop,
the guard, MOA references + aggregation, memory/usage bookkeeping, the whole chain. The model is
the built-in `demo` mock, and its answers are **scripted per scenario** — so a run measures
MAJIN's own plumbing, deterministically, without keys, tokens or network.

That makes it the right tool for:

* **regressions in the harness** — a refactor that adds a serial step, breaks the plan plumbing
  or accidentally double-runs MOA shows up here as seconds and as a failed `expect`
* **the approval path** — `guard-approval` asserts the tool never ran and the file survived, and
  the timing shows the timeout being honoured
* **self-config latency** — `self-config` must stay a single-digit millisecond no-model-call

It says nothing about model quality or provider latency. For actual model behavior, use the separate live evaluator below. Do not interpret the scripted mock benchmark as evidence that a configured model can reason or use tools correctly.

## Live configured-model evaluation

The mock benchmark above verifies MAJIN's plumbing only. To gather behavioral evidence from the model actually configured on this machine:

```bash
npm run eval:live -- --yes
```

This is deliberately opt-in: it runs two live scenarios, each allowing up to eight model steps, and can incur provider charges. It uses MAJIN's normal per-job routing, requires real keyed `tasks` and `final` routes, turns MOA and the classifier tiebreak off for this isolated check, allows only `fs.read`, `fs.write`, and `fs.list`, and confines writes to a temporary workspace that is deleted afterward. It does not change the user's config or workspace. It refuses configured routes matching OpenCode or Qwen and marks any unexpected mock-routed step as a failure. The JSON result reports the selected model routes, tool calls, usage, checks, and pass/fail; redirect stdout to keep the report, for example `npm run eval:live -- --yes > live-eval.json`.

The checks use random markers that the model cannot know without reading a file: (1) retrieve and report a marker, then (2) write a marker, read it back, and report only after verification. Passing is evidence of basic live tool-use and verification for that provider/model at that moment—not proof of general intelligence, Arena parity, or quality on arbitrary tasks. No live provider was exercised in CI; only the deterministic mock harness is suitable for routine CI runs.

## Scenarios

| scenario | what must be true |
|---|---|
| `fs.write` | the tool writes the file; content on disk matches, byte for byte |
| `fs.read+summarize` | read → evidence → answer that actually mentions what was read |
| `re.analyze` | a synthetic PE goes through the parser and produces a report + tool_result |
| `shell.run` | exec path runs (guard off), and the background variant is *not* chosen |
| `multi-step` | three tool steps chain in one turn without losing the plan |
| `self-config` | "run with 4 references" patches `moa.width` with **zero** tool calls |
| `guard-approval` | `guard.mode: strict` asks, the timeout denies, `victim.txt` still exists |

## Reference run

Node v22.22.3, linux/x64, container CPU, `--turns=3`, MOA `always` with width 2 (the defaults are
`always`/3):

```
scenario          pass   avg     p50     p95     tools  steps  events
fs.write          3/3    38ms    30ms    60ms    2      3      20
fs.read+summarize 3/3    50ms    50ms    50ms    2      3      24
re.analyze        3/3    47ms    42ms    59ms    2      3      22
shell.run         3/3    53ms    51ms    57ms    2      3      22
multi-step        3/3    128ms   127ms   130ms   4      5      34
self-config       3/3    12ms    12ms    13ms    0      1      7
guard-approval    3/3    4551ms  4535ms  4582ms  3      4      27

21/21 runs green · p50 50ms · p95 4535ms · 123 provider calls · 89003 tokens · $0
```

Read it as: **a turn of MAJIN's own machinery costs tens of milliseconds** — a tool round trip
with routing, events and MOA overhead lands at 30–130 ms. Everything above that in a real session
is the provider. `guard-approval` is not slow: 4.5 s is exactly 3 × the 1500 ms approval timeout
the harness configures (`tasks.approvalTimeoutMs`), which is the point — a timed-out approval
means *no*, and the refusal costs nothing but the wait you set.

The 89 k tokens are the mock's *estimate* of the prompt sizes (it counts what it was given); cost
is $0 because `demo` has no price entry, and MAJIN refuses to invent one — `pricing` in config is
where a real number comes from.

## Adding a scenario

Push an object into `SCENARIOS` in `scripts/bench.mjs`:

```js
{
  name: 'fs.delete-guarded',
  input: 'delete victim.txt permanently',
  job: 'tasks',
  guard: 'strict',                    // which guard mode this turn runs under
  seed: { 'victim.txt': 'do not delete me\n' },   // files placed in the workspace
  steps: [{ text: 'Deleting.', toolCalls: [{ name: 'fs.delete', args: { path: 'victim.txt', permanent: true } }] },
          { text: 'Refused.' }],      // scripted model turns, one per loop step
  expect: { tool: /^fs\.delete$/, fileAbsent: 'victim.txt', guardAsk: true, events: ['tool_result'] },
}
```

`steps` are scripted for every `main:<job>` key so the scenario passes whichever job the
classifier picks; MOA's reference and aggregator calls are scripted from the last step's text, so
`expect.answer` asserts on the answer the user would actually see. Available `expect` keys:
`tool`, `avoid`, `file` (`{path, contains}`), `fileAbsent`, `events`, `answer`, `config`
(`{path, value}`), `guardAsk`. The verdict is `pass` only if **every** check of **every** run
passes, and `--json` prints the same tree for a CI gate:

```bash
node scripts/bench.mjs --json | tee bench.json && python3 -c "import json;exit(0 if json.load(open('bench.json'))['ok'] else 1)"
```
