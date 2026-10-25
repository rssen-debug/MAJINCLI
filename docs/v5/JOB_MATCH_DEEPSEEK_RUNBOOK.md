# MAJIN V5 job matching and gated DeepSeek handoff

## What “Level 99” means here

`career.job-match` uses V5's verified procedural XP system. It does **not** fine-tune or change model weights. Level 99 requires the XP threshold and all five quality gates: a versioned test suite, varied tasks, verified error recovery, fresh reliable evidence, and an explicit mastery/limitations scope.

A level is evidence for this skill version and test suite, not a guarantee that every future ad or occupation will be handled correctly.

## Verified local sequence

Run from the repository root with Node 22 or later:

```bash
npm ci --ignore-scripts
npm run v5:test
node --test test/jobs.test.js
npm run i18n

# Validate all gold labels without writing XP or artifacts.
npm run v5:train:jobs -- --suite-only --synthetic-count 3600

# Validate first, then award XP only to independently verified outcomes.
npm run v5:train:jobs -- --target-level 99 --synthetic-count 3600

# Local scale/resume check; no model calls and no submissions.
npm run v5:benchmark:jobs -- --count 25000 --error-every 5000

# Start the actual V5 Black Box host.
npm run v5:serve -- --host 0.0.0.0 --port 4555
```

Use the same `--data-dir` for training, serving and handoff when a non-default state directory is desired. The local run recorded here uses `.majin/v5`.

### Evidence recorded on 2026-10-25

- Gold suite: **3,603/3,603 passed** before XP: three real JobTech ads and 3,600 generated variations.
- Saved skill: **`career.job-match` 99/99, 139,344 XP, reliability 1.0**; all five Level 99 gates passed.
- Re-running the completed training awarded **0 XP** and repeated **0 scenarios**.
- Scale run: **25,000 distinct structured ads** completed. Five injected transient errors were the only rows retried; the next stable run resumed 25,000 and processed zero.
- The scale ads are generated benchmark inputs, not 25,000 real production ads and not 25,000 DeepSeek calls.
- No applications were prepared or submitted by the training, canary, or batch-matching paths.

Reports and receipts are runtime data under `.majin/v5/`, not Git fixtures:

- `job-training/latest-report.json`
- `job-training/artifacts/`
- `job-match-scale-latest.json`
- `job-match-runs/<run-id>.jsonl`
- `deepseek-handoff-latest.json`

## Reproducible 500-ad live-V5 replay

The branch includes a contact-redacted 500-record JobTech fixture and a synthetic CV. Start the actual server, then post the fixture through its real goal API:

```bash
npm run v5:serve -- --host 0.0.0.0 --port 4555
# In another terminal:
npm run v5:replay:500
# Smaller provider/cost canary:
npm run v5:replay:500 -- --limit 10
```

The replay uses `mandate: { allowSubmit: false, prepareApplications: false }`. It creates no application drafts, sends no employer contact and submits nothing. The final sandbox replay returned 500 found, 500 unique, 61 matched, 438 `NEEDS_REVIEW`, one definite non-match, zero prepared/submitted/confirmed, and two independent evidence receipts. Two identical post-fix runs plus the committed-fixture replay produced the same counters and outcome.

The final status is intentionally `PARTIAL`, not a false `COMPLETED`: 417 ads lack structured tags, 17 have only preferred tags and four have unresolved mandatory labels. A live-discovered bug that let preferred-only taxonomy auto-qualify candidates was fixed and covered by a regression test before the final replay.

The fixture contains real public JobTech records assembled from public snapshot archives; it is **not** represented as 500 freshly fetched currently open ads. At selection time 323 had a current/future deadline, two were undated and 175 were expired load-test records. Native sandbox JobTech access was blocked, so the report preserves this distinction.

Files:

- `test/fixtures/majin-v5-live-500-input.json`
- `test/fixtures/synthetic-test-cv.txt`
- `test/fixtures/synthetic-test-cv.json`
- `scripts/v5/replay-live-500.mjs`

For the later gated DeepSeek batch on the same fixture:

```bash
npm run v5:deepseek:jobs -- \
  --production \
  --input test/fixtures/majin-v5-live-500-input.json \
  --cv test/fixtures/synthetic-test-cv.json \
  --run-id live-500-deepseek \
  --concurrency 4
```

Use `--limit 10` first to control model cost. The three real-ad DeepSeek canaries must pass before production input is opened.

## Corpus and independent oracles

`test/fixtures/jobtech-real-2026-10-25.json` contains trimmed real JobTech API fields and exact requirement excerpts for:

1. Skatteverket developer ad `31635810` — unstructured Swedish education/experience requirements; ambiguous alternatives must remain `NEEDS_REVIEW`.
2. Surahammars kommun nurse ad `31637450` — licence and driving requirements plus optional merits.
3. First Rider AB truck-driver ad `31543854` — description/taxonomy conflict where YKB is explicitly required in prose despite a preferred taxonomy tag.

Personal contact fields and unrelated API data were omitted. These are real-ad fixtures, not a claim of live native Node connectivity. Native JobTech fetch previously failed in this sandbox while tool-mediated fetch succeeded.

The generated suite independently labels aliases, missing requirements, optional merits, location filters, experience floors, grounded extraction, invalid-response recovery, ambiguous ads and hallucination defense. A gold mismatch blocks the entire training run before XP is awarded.

## DeepSeek safety boundary

The handoff refuses to call a model unless all of these are true:

- `career.job-match` is Level 99 with every gate green.
- The saved active provider is DeepSeek.
- The active model is the exact model whose connection was verified.
- Paid fallback and data-sharing fallback are disabled.
- Three real-ad canaries pass using actual DeepSeek responses.

Configure the DeepSeek credential directly in MAJIN V5's provider UI or its normal local secret configuration. **Never paste API keys into chat or Git.** Select the model and run V5's connection verification. A saved but unverified configuration is not enough.

After V5 reports DeepSeek as connected and verified:

```bash
# Real DeepSeek calls for exactly the three real-ad canaries; no production batch.
npm run v5:deepseek:jobs

# Only after the canary passes: match an input set with the supplied CV facts.
npm run v5:deepseek:jobs -- \
  --production \
  --input /absolute/path/ads.json \
  --cv /absolute/path/cv.json \
  --run-id deepseek-production-01 \
  --concurrency 4
```

Input can be a JSON ad array, a JobTech search response with `hits`, corpus `cases`, or JSONL ads. CV input accepts either direct CV facts or `{ "cvFacts": ..., "criteria": ... }`:

```json
{
  "cvFacts": {
    "skills": ["node.js", "typescript"],
    "languages": ["svenska", "engelska"],
    "roles": [],
    "experienceYears": 5,
    "certificates": []
  },
  "criteria": { "locations": ["Stockholm"] }
}
```

Use a new run ID when the CV or criteria change. A run ID cannot be resumed with a different CV/criteria hash. Successful and deliberate `NEEDS_REVIEW` rows are not repeated; retryable unexpected errors are retried on resume.

### Privacy and submission scope

The selected model receives the ad text and extraction schema, not CV facts. Requirement evidence must be an exact quote from the ad. Malformed, ungrounded or persistently failed extraction becomes `NEEDS_REVIEW`; it never auto-qualifies an applicant. Matching and CV comparisons remain local.

`JobMatchBatch` has no application-submission API and is not subject to the application workflow's 500-submission ceiling. Keep `mandate.allowSubmit: false` for search/match-only operation.

## Current external blocker

At the recorded handoff attempt, V5 reported OpenCode Go with no active model, no saved DeepSeek configuration, and no verified connection. The gate therefore returned `blockedBeforeModelCall: true`. No real DeepSeek request or DeepSeek charge occurred. The production handoff remains blocked until the user completes provider configuration and verification in V5.
