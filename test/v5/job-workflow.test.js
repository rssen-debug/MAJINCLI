import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SkillTree } from '../../src/v5/skill-tree.js';
import {
  JobApplicationWorkflow,
  deduplicateJobListings,
  evaluateJobMatch,
  extractVerifiableCvFacts,
  prepareTruthfulApplication,
} from '../../src/v5/workflows/job-search.js';
import { adaptV1ToolForV5 } from '../../src/v5/inventory.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-jobs-'));
}

const SAMPLE_CV = `
Namn: Erik Lindqvist
E-post: erik.lindqvist@example.com
Telefon: +46 70 555 12 34
Roll: Senior Fullstack Engineer
5 års erfarenhet av TypeScript, Node.js, React, Python, PostgreSQL och Docker.
Utbildning: Civilingenjör Datateknik, KTH
Språk: Svenska, Engelska
Arbetstillstånd: EU-medborgare (Sverige/EU)
`;

test('CV fact extraction, multi-portal deduplication, required vs preferred skill matching, and zero-fabrication preparation', () => {
  const cvFacts = extractVerifiableCvFacts(SAMPLE_CV, { cvFileName: 'erik-cv.pdf', cvSha256: 'sha-erik' });
  assert.equal(cvFacts.fullName, 'Erik Lindqvist');
  assert.equal(cvFacts.email, 'erik.lindqvist@example.com');
  assert.equal(cvFacts.experienceYears, 5);
  assert.ok(cvFacts.skills.includes('typescript'));
  assert.ok(cvFacts.skills.includes('python'));

  // Deduplication across Platsbanken, LinkedIn, and Company portal
  const rawAds = [
    { id: 'pb-1', portal: 'Platsbanken', title: 'Senior Node.js Developer', employer: 'Spotify AB', location: 'Stockholm', requiredSkills: ['node.js', 'typescript'], preferredSkills: ['docker', 'kubernetes'] },
    { id: 'li-1', portal: 'LinkedIn', title: 'Senior Node.js Developer', employer: 'Spotify AB', location: 'Stockholm', requiredSkills: ['node.js', 'typescript'], preferredSkills: ['docker'] },
    { id: 'co-2', portal: 'CompanySite', title: 'Backend Engineer', employer: 'Novo Nordisk', location: 'Köpenhamn', requiredSkills: ['python', 'postgresql'], preferredSkills: ['docker'] },
  ];
  const deduped = deduplicateJobListings(rawAds);
  assert.equal(deduped.foundCount, 3);
  assert.equal(deduped.uniqueCount, 2);
  assert.equal(deduped.duplicateCount, 1);

  // Required vs nice-to-have scoring
  const match1 = evaluateJobMatch(deduped.unique[0], cvFacts);
  assert.equal(match1.matched, true);
  assert.deepEqual(match1.requiredSkills.missing, []);
  assert.ok(match1.preferredSkills.missing.includes('kubernetes'));

  // Truthful application preparation never fabricates missing preferred skills or personal answers
  const prepBlocked = prepareTruthfulApplication(
    { ...deduped.unique[0], personalQuestions: ['salary_expectation'] },
    cvFacts,
    match1,
  );
  assert.equal(prepBlocked.ok, false, 'Missing personal salary expectation must block auto-submit until user answers');
  assert.equal(prepBlocked.blocked, true);

  const prepOk = prepareTruthfulApplication(deduped.unique[0], cvFacts, match1);
  assert.equal(prepOk.ok, true);
  assert.equal(prepOk.application.fabricatedFields, 0);
});

test('JobApplicationWorkflow enforces 500 ceiling, tracks all 8 counters, verifies confirmation beyond Submit click, handles CAPTCHA/MFA blockers, and prevents duplicate submissions on crash recovery', async () => {
  const dir = tmpDir();
  const tree = new SkillTree({ dir });
  let portalSubmitCalls = 0;

  // Create 12 unique ads + 1 duplicate = 13 found
  const ads = [];
  for (let i = 1; i <= 12; i += 1) {
    ads.push({
      id: `job-${i}`,
      portal: i % 2 === 0 ? 'Platsbanken' : 'CompanySite',
      title: `Software Engineer ${i}`,
      employer: `Nordic Tech ${i}`,
      location: i <= 6 ? 'Köpenhamn' : 'Stockholm',
      requiredSkills: ['typescript', 'node.js'],
      preferredSkills: ['docker'],
      requiresCaptcha: i === 3,
      requiresMfa: i === 4,
      simulateClickWithoutConfirmation: i === 5, // Clicked submit, but NO confirmation receipt!
      simulateFailure: i === 6,
    });
  }
  // Duplicate of job-1 on another portal
  ads.push({
    id: 'job-1-dup',
    portal: 'LinkedIn',
    title: 'Software Engineer 1',
    employer: 'Nordic Tech 1',
    location: 'Köpenhamn',
    requiredSkills: ['typescript', 'node.js'],
  });

  const portalAdapter = {
    async submitApplication({ jobId, ad }) {
      portalSubmitCalls += 1;
      if (ad.simulateFailure) {
        return { submitted: false, confirmed: false, error: 'Portal 502 Bad Gateway' };
      }
      if (ad.simulateClickWithoutConfirmation) {
        // Clicked submit button, but portal never returned a confirmation receipt!
        return { submitted: true, confirmed: false, confirmationId: null };
      }
      return {
        submitted: true,
        confirmed: true,
        confirmationId: `CONF-${jobId}`,
        cvSha256Match: true,
      };
    },
  };

  const wf = new JobApplicationWorkflow({
    dataDir: dir,
    skillTree: tree,
    portalAdapter,
  });

  const summary = await wf.run({
    cvText: SAMPLE_CV,
    cvFileName: 'erik-cv.pdf',
    cvSha256: 'sha256-erik-cv-123456',
    jobAds: ads,
    maxTarget: 500,
    mandate: { allowSubmit: true },
  });

  // Verify all 8 counters:
  assert.equal(summary.counters.found, 13);
  assert.equal(summary.counters.unique, 12);
  assert.equal(summary.counters.matched, 12);
  assert.equal(summary.counters.prepared, 12);
  assert.equal(summary.counters.blocked, 2, 'Job 3 (CAPTCHA) and Job 4 (MFA) must be counted as blocked');
  assert.equal(summary.counters.failed, 1, 'Job 6 (502 error) must be counted as failed');
  assert.equal(summary.counters.submitted, 9, '9 applications clicked submit (8 confirmed + 1 unconfirmed)');
  assert.equal(summary.counters.confirmed, 8, 'Only the 8 applications with verified confirmation receipts count as confirmed!');

  // Crash recovery & restart idempotency: resuming after restart must NOT re-submit already confirmed jobs!
  const callsAfterFirstRun = portalSubmitCalls;
  assert.equal(callsAfterFirstRun, 10); // 8 confirmed + 1 unconfirmed + 1 failed

  const wfAfterCrash = new JobApplicationWorkflow({
    dataDir: dir,
    skillTree: tree,
    portalAdapter,
  });
  await wfAfterCrash.resumeAfterRestart();
  assert.equal(portalSubmitCalls, callsAfterFirstRun, 'Restart recovery must never re-submit already submitted/confirmed applications');
});

test('JobApplicationWorkflow explicit match-only mode creates no application drafts', async () => {
  const dir = tmpDir();
  const wf = new JobApplicationWorkflow({ dataDir: dir });
  const summary = await wf.run({
    cvText: SAMPLE_CV,
    jobAds: [
      { id: 'match-only-1', title: 'TypeScript role', employer: 'One', location: 'Stockholm', requiredSkills: ['typescript'] },
      { id: 'match-only-2', title: 'Rust role', employer: 'Two', location: 'Stockholm', requiredSkills: ['rust'] },
    ],
    mandate: { allowSubmit: false, prepareApplications: false },
  });
  assert.equal(summary.counters.found, 2);
  assert.equal(summary.counters.matched, 1);
  assert.equal(summary.counters.prepared, 0);
  assert.equal(summary.counters.submitted, 0);
  assert.equal(summary.counters.confirmed, 0);
  assert.equal(summary.mandate.prepareApplications, false);
  assert.ok(summary.items.every((item) => item.application === null && item.prepared === false));
});

test('JobApplicationWorkflow supports mid-flight steering ("Nej vänta, bara jobb i Köpenhamn", "Öppna de fyra bästa") and V5 tool adapter preserves extra job fields', async () => {
  const dir = tmpDir();
  const wf = new JobApplicationWorkflow({ dataDir: dir });

  const ads = [
    { id: 'cph-1', title: 'Engineer 1', employer: 'Co 1', location: 'Köpenhamn', requiredSkills: ['typescript'] },
    { id: 'cph-2', title: 'Engineer 2', employer: 'Co 2', location: 'Köpenhamn', requiredSkills: ['typescript'] },
    { id: 'cph-3', title: 'Engineer 3', employer: 'Co 3', location: 'Köpenhamn', requiredSkills: ['typescript'] },
    { id: 'cph-4', title: 'Engineer 4', employer: 'Co 4', location: 'Köpenhamn', requiredSkills: ['typescript'] },
    { id: 'sth-5', title: 'Engineer 5', employer: 'Co 5', location: 'Stockholm', requiredSkills: ['typescript'] },
  ];

  // Run without submitting so items stay PREPARED in queue
  await wf.run({
    cvText: SAMPLE_CV,
    jobAds: ads,
    mandate: { allowSubmit: false },
  });

  // Steer 1: "Nej vänta, bara jobb i Köpenhamn"
  const steer1 = await wf.steerWorkflow({ instruction: 'Nej vänta, bara jobb i Köpenhamn' }); // input vocabulary, never rendered
  assert.equal(steer1.steered, true);
  assert.equal(steer1.cancelledQueuedItems, 1, 'Stockholm job must be cancelled when steering to Köpenhamn only');

  // Steer 2: "Öppna de fyra bästa"
  const steer2 = await wf.steerWorkflow({ instruction: 'Öppna de fyra bästa' }); // input vocabulary, never rendered
  assert.equal(steer2.openedTopJobs.length, 4);

  // Verify adaptV1ToolForV5 preserves extra fields (`total`, `seenBefore`, `applications`, `counts`, `rows`)
  const adaptedJobsSearch = adaptV1ToolForV5({
    name: 'jobs.search',
    description: 'Search jobs',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
    async run() {
      return {
        ok: true,
        output: 'Found 2 jobs',
        total: 2,
        seenBefore: 1,
        applications: [{ id: 'app-1' }],
        counts: { matched: 2 },
        rows: [{ id: 'row-1' }],
      };
    },
  });
  const parsedOutput = adaptedJobsSearch.outputSchema.parse(await adaptedJobsSearch.execute({ query: 'node' }));
  assert.equal(parsedOutput.total, 2);
  assert.equal(parsedOutput.seenBefore, 1);
  assert.equal(parsedOutput.applications.length, 1);
  assert.equal(parsedOutput.counts.matched, 2);
  assert.equal(parsedOutput.rows.length, 1);
});
