import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeJobAd } from '../../src/v5/job-ad.js';
import {
  JobMatchBatch,
  matchJobAd,
  parseGroundedExtraction,
} from '../../src/v5/job-matcher.js';
import {
  JobApplicationWorkflow,
  evaluateJobMatch,
  extractVerifiableCvFacts,
} from '../../src/v5/workflows/job-search.js';

const CV = {
  fullName: 'Test Person',
  email: 'private@example.test',
  skills: ['node.js', 'typescript', 'postgresql', 'docker', 'ce-körkort', 'ykb'],
  languages: ['svenska', 'engelska'],
  roles: ['backend developer'],
  experienceYears: 5,
  certificates: [],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-job-matcher-'));
}

test('Platsbanken/V5 field aliases and qualification synonyms match without losing required vs preferred', () => {
  const raw = {
    id: 31635810,
    headline: 'Backendutvecklare',
    employer: { name: 'Exempel AB' },
    webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/31635810',
    workplace_address: { municipality: 'Stockholm', city: null },
    description: { text: 'Node.js och TypeScript. PostgreSQL är meriterande.' },
    must_have: { skills: [{ label: 'Node.js' }], languages: [{ label: 'Svenska' }] },
    nice_to_have: { skills: [{ label: 'PostgreSQL' }, { label: 'GraphQL' }], languages: [] },
  };
  const ad = normalizeJobAd(raw);
  assert.equal(ad.id, '31635810');
  assert.equal(ad.employer, 'Exempel AB');
  assert.equal(ad.location, 'Stockholm');
  const result = evaluateJobMatch(ad, CV, { locations: ['stockholm'] });
  assert.equal(result.matched, true);
  assert.ok(result.requiredSkills.met.includes('node.js'));
  assert.ok(result.requiredSkills.met.includes('svenska'));
  assert.ok(result.preferredSkills.met.includes('postgresql'));
  assert.ok(result.preferredSkills.missing.includes('graphql'));

  const sqlResult = evaluateJobMatch({ title: 'SQL role', requiredSkills: ['SQL'], noRequirements: false }, CV);
  assert.equal(sqlResult.matched, true, 'PostgreSQL explicitly satisfies a general SQL requirement');
});

test('unstructured or empty tags never mean that every applicant qualifies', async () => {
  const ad = { id: 'unknown-1', title: 'Sjuksköterska', employer: 'Vård AB', location: 'Stockholm', description: 'Legitimation krävs.' };
  const result = evaluateJobMatch(ad, CV);
  assert.equal(result.matched, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.score, null);

  const dir = tmpDir();
  const wf = new JobApplicationWorkflow({ dataDir: dir });
  const summary = await wf.run({
    cvText: 'Test Person\nprivate@example.test\nNode.js, TypeScript, svenska och engelska.',
    jobAds: [ad],
    mandate: { allowSubmit: false },
  });
  assert.equal(summary.counters.matched, 0);
  assert.equal(summary.counters.prepared, 0);
  assert.equal(summary.counters.needsReview, 1);
  assert.equal(summary.status, 'PARTIAL');
});

test('DeepSeek-style extraction is grounded, keeps CV private and recovers from one malformed answer', async () => {
  const ad = {
    id: 'model-1',
    title: 'Senior backendutvecklare',
    employer: 'Model AB',
    location: 'Stockholm',
    description: 'Krav: Node.js och TypeScript. Meriterande: Docker. Minst 3 års erfarenhet.',
  };
  const good = JSON.stringify({
    requiredSkills: [
      { name: 'Node.js', evidence: 'Node.js' },
      { name: 'TypeScript', evidence: 'TypeScript' },
    ],
    preferredSkills: [{ name: 'Docker', evidence: 'Docker' }],
    minExperienceYears: 3,
    experienceEvidence: 'Minst 3 års erfarenhet',
    noRequirements: false,
    noRequirementsEvidence: null,
  });
  let calls = 0;
  const complete = async (request) => {
    calls += 1;
    const wire = JSON.stringify(request.messages);
    assert.equal(wire.includes(CV.email), false, 'private CV facts must not be sent to the ad extraction model');
    assert.equal(wire.includes(ad.description), true);
    return calls === 1 ? { text: 'not-json' } : { text: good };
  };
  const result = await matchJobAd({ ad, cvFacts: CV, complete });
  assert.equal(calls, 2);
  assert.equal(result.matched, true);
  assert.equal(result.needsReview, false);
  assert.equal(result.provenance, 'model-grounded');
  assert.equal(result.recoveredFromFailure, true);
  assert.equal(result.modelCalls, 2);
  assert.ok(result.preferredSkills.met.includes('docker'));
  assert.equal(result.extraction.minExperienceYears, 3);
});

test('hallucinated requirements/evidence are rejected and left for review, never auto-matched', async () => {
  const ad = { id: 'model-bad', title: 'Utvecklare', description: 'Vi söker en utvecklare i Stockholm.' };
  const hallucination = JSON.stringify({
    requiredSkills: [{ name: 'Kubernetes', evidence: 'Kubernetes med fem års erfarenhet' }],
    preferredSkills: [],
    minExperienceYears: 5,
    experienceEvidence: 'fem års erfarenhet',
    noRequirements: false,
    noRequirementsEvidence: null,
  });
  assert.throws(() => parseGroundedExtraction(hallucination, ad), /evidence|Experience/i);
  const result = await matchJobAd({ ad, cvFacts: CV, complete: async () => ({ text: hallucination }), maxAttempts: 1 });
  assert.equal(result.matched, false);
  assert.equal(result.needsReview, true);
  assert.equal(result.provenance, 'model-failed-needs-review');
});

test('structured ads avoid paid model calls and explicit no-requirement ads remain possible', async () => {
  let calls = 0;
  const complete = async () => { calls += 1; return { text: '{}' }; };
  const structured = await matchJobAd({ ad: { id: 'tagged', requiredSkills: ['Node.js'] }, cvFacts: CV, complete });
  assert.equal(structured.matched, true);
  assert.equal(structured.modelCalls, 0);
  assert.equal(calls, 0);

  const noReqAd = { id: 'no-req', title: 'Trainee', description: 'Inga formella krav. Vi lär upp dig.' };
  const noReq = await matchJobAd({
    ad: noReqAd,
    cvFacts: CV,
    complete: async () => ({ text: JSON.stringify({
      requiredSkills: [], preferredSkills: [], minExperienceYears: null, experienceEvidence: null,
      noRequirements: true, noRequirementsEvidence: 'Inga formella krav',
    }) }),
  });
  assert.equal(noReq.matched, true);
  assert.equal(noReq.provenance, 'model-grounded');
});

test('preferred-only taxonomy never proves that an applicant meets unknown mandatory requirements', async () => {
  const cvFacts = { skills: ['node.js'], languages: [], roles: [], experienceYears: 4, certificates: [] };
  const review = await matchJobAd({
    ad: { id: 'preferred-only', title: 'Node role', preferredSkills: ['Node.js'], description: '' },
    cvFacts,
  });
  assert.equal(review.matched, false);
  assert.equal(review.needsReview, true);
  assert.equal(review.reason, 'REQUIREMENTS_UNSTRUCTURED');
  assert.deepEqual(review.preferredSkills.met, ['node.js']);

  const explicitNoRequirements = await matchJobAd({
    ad: { id: 'explicit-none', title: 'Open role', preferredSkills: ['Node.js'], noRequirements: true },
    cvFacts,
  });
  assert.equal(explicitNoRequirements.matched, true);
  assert.equal(explicitNoRequirements.needsReview, false);
});

test('large-match store is resumable and idempotent, with no application submission path', async () => {
  const dir = tmpDir();
  let calls = 0;
  const matcher = async ({ ad, cvFacts, criteria }) => {
    calls += 1;
    return matchJobAd({ ad, cvFacts, criteria });
  };
  const ads = Array.from({ length: 40 }, (_, i) => ({
    id: `batch-${i}`,
    title: `Node role ${i}`,
    employer: `Company ${i}`,
    location: i % 2 ? 'Stockholm' : 'Göteborg',
    requiredSkills: ['Node.js'],
    preferredSkills: ['Docker'],
  }));
  const batch = new JobMatchBatch({ dataDir: dir, matcher, concurrency: 6 });
  const first = await batch.run({ runId: 'forty-ads', ads, cvFacts: CV });
  assert.equal(first.unique, 40);
  assert.equal(first.completed, 40);
  assert.equal(first.matched, 40);
  assert.equal(calls, 40);
  const resumed = await batch.run({ runId: 'forty-ads', ads, cvFacts: CV });
  assert.equal(resumed.resumed, 40);
  assert.equal(resumed.processed, 0);
  assert.equal(calls, 40, 'resume must not repeat completed model/match work');
  const rows = fs.readFileSync(first.file, 'utf8').trim().split('\n');
  assert.equal(rows.length, 40);
  assert.equal(Object.hasOwn(first, 'submitted'), false);
  assert.equal(Object.hasOwn(first, 'confirmed'), false);
});

test('large-match store retries only retryable transport errors, not grounded review outcomes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-batch-retry-'));
  const ads = [1, 2, 3].map((n) => ({ id: `ad-${n}`, title: `Role ${n}`, requiredSkills: ['Node.js'] }));
  const cvFacts = { skills: ['node.js'], languages: [], roles: [], experienceYears: 3, certificates: [] };
  let fail = true;
  const calls = [];
  const batch = new JobMatchBatch({ dataDir: dir, concurrency: 2, matcher: async ({ ad }) => {
    calls.push(ad.id);
    if (fail && ad.id === 'ad-2') throw new Error('temporary transport failure');
    return matchJobAd({ ad, cvFacts });
  } });
  const first = await batch.run({ runId: 'retry-run', ads, cvFacts });
  assert.equal(first.errors, 1);
  assert.equal(first.needsReview, 1);
  fail = false;
  const second = await batch.run({ runId: 'retry-run', ads, cvFacts });
  assert.equal(second.resumed, 2);
  assert.equal(second.processed, 1);
  assert.equal(second.errors, 0);
  assert.equal(second.matched, 3);
  assert.equal(calls.filter((id) => id === 'ad-2').length, 2);
  assert.equal(calls.filter((id) => id === 'ad-1').length, 1);
});

test('CV extraction covers non-tech qualifications without pretending a title is a license', () => {
  const driver = extractVerifiableCvFacts('Test Person\nCE-körkort, giltigt YKB och digitalt förarkort. Svenska och engelska.');
  assert.ok(driver.skills.includes('ce-körkort'));
  assert.ok(driver.skills.includes('ykb'));
  assert.ok(driver.skills.includes('digitalt förarkort'));
  const nurse = extractVerifiableCvFacts('Test Person\nSjuksköterska. Erfarenhet av äldrevård.');
  assert.ok(nurse.skills.includes('sjuksköterska'));
  assert.equal(nurse.skills.includes('legitimerad sjuksköterska'), false);
});
