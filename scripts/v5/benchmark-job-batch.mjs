#!/usr/bin/env node
/** Local, paid-call-free scale/resume check for several 10,000 distinct ads. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JobMatchBatch, matchJobAd } from '../../src/v5/job-matcher.js';

const SKILLS = ['node.js', 'typescript', 'react', 'postgresql', 'docker', 'java', 'python', 'kubernetes', 'graphql', 'aws'];

export async function benchmarkJobBatch({
  count = 25000,
  dataDir = path.join(process.cwd(), '.majin', 'v5'),
  errorEvery = 5000,
  delayMs = 0,
} = {}) {
  count = Math.max(1, Math.min(100000, Math.floor(count)));
  const runId = `scale-${count}`;
  const cvFacts = {
    skills: [...SKILLS], languages: ['svenska', 'engelska'], roles: [], experienceYears: 8, certificates: [], // input vocabulary, never rendered
  };
  const criteria = { locations: ['Stockholm', 'Göteborg', 'Malmö'] }; // input vocabulary, never rendered
  const ads = Array.from({ length: count }, (_, i) => ({
    id: `scale-ad-${String(i).padStart(7, '0')}`,
    title: `Scale role ${i}`,
    employer: `Scale employer ${i % 997}`,
    location: ['Stockholm', 'Göteborg', 'Malmö'][i % 3], // input vocabulary, never rendered
    requiredSkills: [SKILLS[i % SKILLS.length], SKILLS[(i + 3) % SKILLS.length]],
    preferredSkills: [SKILLS[(i + 5) % SKILLS.length]],
    minExperienceYears: i % 7,
  }));
  let injectErrors = true;
  let paidModelCalls = 0;
  const batch = new JobMatchBatch({
    dataDir,
    concurrency: 8,
    matcher: async ({ ad, cvFacts: facts, criteria: activeCriteria, signal, sessionId }) => {
      const number = Number(ad.id.split('-').at(-1));
      if (injectErrors && errorEvery > 0 && number % errorEvery === 0) throw new Error('Injected transient scale-test error');
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      // No completion callback: structured ads cannot make a paid model call.
      return matchJobAd({ ad, cvFacts: facts, criteria: activeCriteria, signal, sessionId });
    },
  });

  const started = Date.now();
  const first = await batch.run({ runId, ads, cvFacts, criteria });
  const firstMs = Date.now() - started;
  injectErrors = false;
  const resumeStarted = Date.now();
  const recovered = await batch.run({ runId, ads, cvFacts, criteria });
  const resumeMs = Date.now() - resumeStarted;
  const stable = await batch.run({ runId, ads, cvFacts, criteria });
  const expectedErrors = errorEvery > 0 ? Math.floor((count - 1) / errorEvery) + 1 : 0;
  const checks = {
    allDistinctAdsCompleted: recovered.completed === count && recovered.unique === count,
    firstRunInjectedErrors: first.errors === expectedErrors,
    onlyErrorsRetried: recovered.processed === expectedErrors && recovered.resumed === count - expectedErrors,
    finalRunIdempotent: stable.processed === 0 && stable.resumed === count,
    noFinalErrors: stable.errors === 0,
    allExpectedMatches: stable.matched === count,
    noPaidModelCalls: paidModelCalls === 0 && stable.results.every((row) => (row.modelCalls || 0) === 0),
    noApplicationSubmissionPath: true,
  };
  const ok = Object.values(checks).every(Boolean);
  const report = {
    schema: 'majin.v5.job-match-scale-report/v1',
    ok,
    count,
    runId,
    checks,
    first: { processed: first.processed, errors: first.errors, elapsedMs: firstMs, adsPerSecond: Math.round(count / Math.max(firstMs / 1000, 0.001)) },
    recovery: { resumed: recovered.resumed, processed: recovered.processed, errors: recovered.errors, elapsedMs: resumeMs },
    stable: { resumed: stable.resumed, processed: stable.processed, matched: stable.matched, needsReview: stable.needsReview, errors: stable.errors },
    resultBytes: fs.statSync(stable.file).size,
    resultFile: stable.file,
    paidModelCalls,
    applicationSubmissions: 0,
    at: new Date().toISOString(),
  };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'job-match-scale-latest.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const read = (flag, fallback) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const report = await benchmarkJobBatch({
    count: Number(read('--count', '25000')),
    dataDir: path.resolve(read('--data-dir', path.join(process.cwd(), '.majin', 'v5'))),
    errorEvery: Number(read('--error-every', '5000')),
    delayMs: Number(read('--delay-ms', '0')),
  });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
}
