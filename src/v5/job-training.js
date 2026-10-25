/**
 * MAJIN V5 — versioned job-match evaluation and verified skill training.
 *
 * This is procedural skill progression, not model-weight fine-tuning. Gold
 * labels live outside the matcher. XP is awarded only after the match result
 * matches that gold and an independent file verifier checks the evidence.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runVerifier } from '../v2/runtime/verifiers.js';
import { SkillTree, computeEnvironmentFingerprint } from './skill-tree.js';
import { matchJobAd } from './job-matcher.js';
import { xpForLevel } from './xp-engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REAL_JOB_CORPUS = path.resolve(HERE, '../../test/fixtures/jobtech-real-2026-10-25.json');
export const JOB_TRAINING_SUITE_VERSION = 'job-match-2026.10.25-v2-real500';

const TECH = ['node.js', 'typescript', 'react', 'postgresql', 'docker', 'java', 'python', 'kubernetes', 'graphql', 'aws'];
const HEALTH = ['legitimerad sjuksköterska', 'geriatrik', 'demensvård', 'psykiatri', 'b-körkort', 'finska']; // input vocabulary, never rendered
const TRANSPORT = ['c-körkort', 'ce-körkort', 'ykb', 'digitalt förarkort']; // input vocabulary, never rendered
const CITIES = ['Stockholm', 'Göteborg', 'Malmö', 'Östersund', 'Surahammar', 'Köpenhamn']; // input vocabulary, never rendered
const LABELS = {
  'node.js': ['Node.js', 'NodeJS', 'node'],
  typescript: ['TypeScript', 'TS'],
  react: ['React', 'React.js'],
  postgresql: ['PostgreSQL', 'Postgres'],
  docker: ['Docker'],
  java: ['Java', 'Spring Boot'],
  python: ['Python'],
  kubernetes: ['Kubernetes', 'K8s'],
  graphql: ['GraphQL'],
  aws: ['AWS', 'Amazon Web Services'],
  'legitimerad sjuksköterska': ['legitimerad sjuksköterska', 'sjuksköterskelegitimation'], // input vocabulary, never rendered
  geriatrik: ['geriatrik', 'äldrevård'], // input vocabulary, never rendered
  'demensvård': ['demensvård', 'dementia care'], // input vocabulary, never rendered
  psykiatri: ['psykiatri', 'psychiatric care'], // input vocabulary, never rendered
  'b-körkort': ['B-körkort', 'körkort B'], // input vocabulary, never rendered
  finska: ['finska', 'Finnish'], // input vocabulary, never rendered
  'c-körkort': ['C-körkort', 'C-behörighet'], // input vocabulary, never rendered
  'ce-körkort': ['CE-körkort', 'CE-Behörighet'], // input vocabulary, never rendered
  ykb: ['YKB', 'Giltigt YKB'],
  'digitalt förarkort': ['digitalt förarkort', 'Digitalt förarkort'], // input vocabulary, never rendered
};

function pick(list, index) {
  return list[((index % list.length) + list.length) % list.length];
}

function labelFor(id, index) {
  const labels = LABELS[id] || [id];
  return pick(labels, index);
}

function canonicalSet(list) {
  return [...new Set(list)].sort();
}

/** Independent gold calculation over the scenario author's canonical intent. */
function gold({ required = [], preferred = [], available = [], languages = [], minYears = 0, years = 6 }) {
  const present = new Set([...available, ...languages]);
  // Gold-domain equivalences are stated independently of the production helper.
  const satisfies = (id) => present.has(id)
    || (id === 'c-körkort' && present.has('ce-körkort')) // input vocabulary, never rendered
    || (id === 'körkort' && ['b-körkort', 'c-körkort', 'ce-körkort'].some((x) => present.has(x))) // input vocabulary, never rendered
    || (id === 'sql' && ['postgresql', 'mysql'].some((x) => present.has(x)));
  const requiredMet = required.filter(satisfies);
  const requiredMissing = required.filter((id) => !satisfies(id));
  const preferredMet = preferred.filter(satisfies);
  const preferredMissing = preferred.filter((id) => !satisfies(id));
  return {
    matched: requiredMissing.length === 0 && years >= minYears,
    needsReview: false,
    requiredMet: canonicalSet(requiredMet),
    requiredMissing: canonicalSet(requiredMissing),
    preferredMet: canonicalSet(preferredMet),
    preferredMissing: canonicalSet(preferredMissing),
  };
}

function scenarioFromStructured(index, family) {
  const domain = index % 3;
  const catalog = domain === 0 ? TECH : domain === 1 ? HEALTH : TRANSPORT;
  const required = [pick(catalog, index), pick(catalog, index + 1)];
  const preferred = [pick(catalog, index + 2), pick(catalog, index + 3)].filter((id) => !required.includes(id));
  const available = [...required];
  if (family === 'structured-missing') available.pop();
  const languages = domain === 0 ? ['svenska', 'engelska'] : ['svenska']; // input vocabulary, never rendered
  const years = (index % 8) + 1;
  const minYears = family === 'experience-floor' ? ((index + 2) % 7) : 0;
  const city = pick(CITIES, index);
  const criteria = family === 'location-filter' ? { locations: [pick(CITIES, index + 1)] } : {};
  const expected = family === 'location-filter'
    ? { matched: false, needsReview: false }
    : gold({ required, preferred, available, languages, minYears, years });
  const difficulty = ['structured-alias', 'model-extraction', 'model-recovery'].includes(family) ? 'advanced'
    : ['preferred-is-optional', 'location-filter'].includes(family) ? 'standard' : 'complex';
  return {
    id: `synthetic-${family}-${String(index).padStart(5, '0')}`,
    family,
    synthetic: true,
    difficulty,
    ad: {
      id: `ad-${family}-${index}`,
      title: `${domain === 0 ? 'Developer' : domain === 1 ? 'Nurse' : 'Driver'} scenario ${index}`,
      employer: `Training Employer ${index}`,
      location: city,
      requiredSkills: required.map((id, n) => labelFor(id, index + n)),
      preferredSkills: preferred.map((id, n) => labelFor(id, index + n + 1)),
      minExperienceYears: minYears,
    },
    cvFacts: { skills: available, languages, roles: [], experienceYears: years, certificates: [] },
    criteria,
    expected,
  };
}

function scenarioFromModel(index, family) {
  const base = scenarioFromStructured(index, family === 'model-recovery' ? 'structured-alias' : 'model-extraction');
  const required = base.ad.requiredSkills.map((_, n) => {
    const catalog = index % 3 === 0 ? TECH : index % 3 === 1 ? HEALTH : TRANSPORT;
    return pick(catalog, index + n);
  });
  const preferred = base.ad.preferredSkills.map((_, n) => {
    const catalog = index % 3 === 0 ? TECH : index % 3 === 1 ? HEALTH : TRANSPORT;
    return pick(catalog, index + n + 2);
  }).filter((id) => !required.includes(id));
  const requiredText = required.map((id, n) => labelFor(id, index + n)).join(' och '); // input vocabulary, never rendered
  const preferredText = preferred.map((id, n) => labelFor(id, index + n + 1)).join(' och '); // input vocabulary, never rendered
  const description = `Krav: ${requiredText}. Meriterande: ${preferredText}.`; // input vocabulary, never rendered
  const teacher = {
    requiredSkills: required.map((id, n) => ({ name: labelFor(id, index + n), evidence: labelFor(id, index + n) })),
    preferredSkills: preferred.map((id, n) => ({ name: labelFor(id, index + n + 1), evidence: labelFor(id, index + n + 1) })),
    minExperienceYears: null,
    experienceEvidence: null,
    noRequirements: false,
    noRequirementsEvidence: null,
  };
  return {
    ...base,
    id: `synthetic-${family}-${String(index).padStart(5, '0')}`,
    family,
    difficulty: 'advanced',
    ad: {
      id: `ad-${family}-${index}`,
      title: `Model extraction scenario ${index}`,
      employer: `Model Training Employer ${index}`,
      location: base.ad.location,
      description,
      requiredSkills: [],
      preferredSkills: [],
    },
    teacher,
    failureMode: family === 'model-recovery' ? 'invalid-then-valid' : null,
    expected: { ...base.expected, recoveredFromFailure: family === 'model-recovery' },
  };
}

function reviewScenario(index, family) {
  const badEvidence = family === 'hallucination-defense';
  return {
    id: `synthetic-${family}-${String(index).padStart(5, '0')}`,
    family,
    synthetic: true,
    difficulty: badEvidence ? 'advanced' : 'complex',
    ad: {
      id: `ad-${family}-${index}`,
      title: `Ambiguous role ${index}`,
      employer: `Review Employer ${index}`,
      location: pick(CITIES, index),
      description: badEvidence ? `Vi söker en medarbetare i ${pick(CITIES, index)}.` : 'Kontakta oss för mer information om rollen.', // input vocabulary, never rendered
    },
    cvFacts: { skills: ['node.js'], languages: ['svenska'], roles: [], experienceYears: 4, certificates: [] }, // input vocabulary, never rendered
    criteria: {},
    teacher: badEvidence ? {
      requiredSkills: [{ name: 'Kubernetes', evidence: 'Kubernetes med tio års erfarenhet' }], // input vocabulary, never rendered
      preferredSkills: [], minExperienceYears: 10, experienceEvidence: 'tio års erfarenhet', // input vocabulary, never rendered
      noRequirements: false, noRequirementsEvidence: null,
    } : {
      requiredSkills: [], preferredSkills: [], minExperienceYears: null, experienceEvidence: null,
      noRequirements: false, noRequirementsEvidence: null,
    },
    failureMode: badEvidence ? 'always-ungrounded' : null,
    expected: {
      matched: false,
      needsReview: true,
      provenance: badEvidence ? 'model-failed-needs-review' : 'model-grounded',
    },
  };
}

export function loadRealJobScenarios(file = REAL_JOB_CORPUS) {
  const corpus = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (corpus.schema !== 'majin.v5.job-training-corpus/v1' || !Array.isArray(corpus.cases)) {
    throw new Error('Unsupported real job corpus');
  }
  return corpus.cases.map((item) => ({ ...item, synthetic: false, source: corpus.source }));
}

/** Round-robin families prevent a long run from mastering only one narrow pattern. */
export function buildJobTrainingScenarios({ syntheticCount = 3600, realCorpus = REAL_JOB_CORPUS } = {}) {
  const real = loadRealJobScenarios(realCorpus);
  const families = [
    'structured-alias',
    'structured-missing',
    'preferred-is-optional',
    'location-filter',
    'experience-floor',
    'model-extraction',
    'model-recovery',
    'ambiguous-review',
    'hallucination-defense',
  ];
  const synthetic = [];
  for (let i = 0; i < syntheticCount; i += 1) {
    const family = families[i % families.length];
    if (family === 'model-extraction' || family === 'model-recovery') synthetic.push(scenarioFromModel(i, family));
    else if (family === 'ambiguous-review' || family === 'hallucination-defense') synthetic.push(reviewScenario(i, family));
    else synthetic.push(scenarioFromStructured(i, family));
  }
  return [...real, ...synthetic];
}

function completionFor(scenario) {
  if (!scenario.teacher) return null;
  let calls = 0;
  return async () => {
    calls += 1;
    if (scenario.failureMode === 'invalid-then-valid' && calls === 1) return { text: '{"requiredSkills":' };
    if (scenario.failureMode === 'always-ungrounded') {
      return { text: JSON.stringify({ ...scenario.teacher, requiredSkills: [{ name: 'Kubernetes', evidence: 'invented evidence not in ad' }] }) };
    }
    return { text: JSON.stringify(scenario.teacher) };
  };
}

export function validateJobMatchResult(expected, actual) {
  const failures = [];
  for (const key of ['matched', 'needsReview', 'recoveredFromFailure', 'provenance']) {
    if (expected[key] !== undefined && actual[key] !== expected[key]) failures.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
  }
  const groups = [
    ['requiredMet', actual.requiredSkills?.met],
    ['requiredMissing', actual.requiredSkills?.missing],
    ['preferredMet', actual.preferredSkills?.met],
    ['preferredMissing', actual.preferredSkills?.missing],
  ];
  for (const [key, value] of groups) {
    if (expected[key] !== undefined && JSON.stringify(canonicalSet(value || [])) !== JSON.stringify(canonicalSet(expected[key]))) {
      failures.push(`${key}: expected ${canonicalSet(expected[key]).join('|')}, got ${canonicalSet(value || []).join('|')}`);
    }
  }
  return failures;
}

export async function runJobTrainingScenario(scenario) {
  const actual = await matchJobAd({
    ad: scenario.ad,
    cvFacts: scenario.cvFacts,
    criteria: scenario.criteria || {},
    complete: completionFor(scenario),
    maxAttempts: 2,
    sessionId: `training:${scenario.id}`,
  });
  const failures = validateJobMatchResult(scenario.expected, actual);
  return {
    ok: failures.length === 0,
    scenarioId: scenario.id,
    family: scenario.family,
    synthetic: scenario.synthetic !== false,
    failures,
    expected: scenario.expected,
    actual: {
      matched: actual.matched,
      needsReview: actual.needsReview,
      provenance: actual.provenance,
      recoveredFromFailure: actual.recoveredFromFailure,
      modelCalls: actual.modelCalls,
      requiredSkills: actual.requiredSkills,
      preferredSkills: actual.preferredSkills,
    },
    recoveredFromFailure: actual.recoveredFromFailure === true,
  };
}

function hashValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function writeVerifiedArtifact({ dir, result, scenario }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${scenario.id}.json`);
  const body = `${JSON.stringify({
    schema: 'majin.v5.job-training-receipt/v1',
    scenarioId: scenario.id,
    family: scenario.family,
    suiteVersion: JOB_TRAINING_SUITE_VERSION,
    verdict: 'PASS',
    expectedSha256: hashValue(result.expected),
    actualSha256: hashValue(result.actual),
  }, null, 2)}\n`;
  fs.writeFileSync(file, body, { mode: 0o600 });
  const sha256 = crypto.createHash('sha256').update(body).digest('hex');
  const verified = await runVerifier('file', { path: file, minBytes: 100, hash: sha256 });
  if (!verified.verified) throw new Error(`Independent verifier rejected ${scenario.id}`);
  return {
    id: `rcpt-jobtrain-${scenario.id}`,
    receiptId: `rcpt-jobtrain-${scenario.id}`,
    kind: 'file',
    verifier: 'file',
    verified: true,
    path: file,
    sha256,
    at: new Date().toISOString(),
  };
}

/**
 * Validate the whole selected suite before changing XP. A single failed gold
 * comparison blocks the run; MAJIN cannot train on its own incorrect answers.
 */
export async function trainJobMatching({
  dataDir,
  skillTree = null,
  scenarios = null,
  targetLevel = 99,
  suiteOnly = false,
  onProgress = null,
} = {}) {
  if (!dataDir && !skillTree) throw new Error('trainJobMatching requires dataDir or skillTree');
  const started = Date.now();
  const suite = scenarios || buildJobTrainingScenarios();
  if (!suite.length) throw new Error('Empty job training suite');
  const validation = [];
  const failures = [];
  for (const scenario of suite) {
    const result = await runJobTrainingScenario(scenario);
    validation.push(result);
    if (!result.ok) failures.push(result);
  }
  const report = {
    schema: 'majin.v5.job-training-report/v1',
    suiteVersion: JOB_TRAINING_SUITE_VERSION,
    learningType: 'verified-procedural-skill-progression',
    weightsTrained: false,
    suiteOnly,
    startedAt: new Date(started).toISOString(),
    scenariosValidated: validation.length,
    realAds: suite.filter((s) => s.synthetic === false).length,
    syntheticAds: suite.filter((s) => s.synthetic !== false).length,
    families: [...new Set(suite.map((s) => s.family))],
    validationFailures: failures,
  };
  if (failures.length) return { ...report, ok: false, elapsedMs: Date.now() - started };
  if (suiteOnly) return { ...report, ok: true, elapsedMs: Date.now() - started };

  const tree = skillTree || new SkillTree({ dir: dataDir });
  const skillId = 'career.job-match';
  const skill = tree.get(skillId);
  if (!skill) throw new Error(`Missing ${skillId}`);
  const outputDir = path.join(dataDir || tree.dir, 'job-training');
  const artifactDir = path.join(outputDir, 'artifacts');
  const envFingerprint = computeEnvironmentFingerprint({ availableTools: ['jobs.search', 'jobs.match'] });
  let processed = 0;
  let awarded = 0;
  let duplicates = 0;
  let recovered = 0;
  let xpAwarded = 0;

  for (const scenario of suite) {
    let current = tree.get(skillId);
    if (current.level >= targetLevel && (targetLevel < 99 || current.level99Evaluation?.passed !== false)) break;
    const result = await runJobTrainingScenario(scenario);
    if (!result.ok) {
      tree.recordFailure({ skillId, goalId: `jobtrain:${scenario.id}`, stepTool: 'jobs.match', failureClass: 'GOLD_MISMATCH' });
      return { ...report, ok: false, trainingFailure: result, skill: tree.get(skillId) };
    }
    const receipt = await writeVerifiedArtifact({ dir: artifactDir, result, scenario });
    const award = await tree.recordVerifiedSuccess({
      goalId: `jobtrain:${scenario.id}`,
      receipts: [receipt],
      taskSignature: `job-match:${scenario.family}:${scenario.id}`,
      difficulty: scenario.difficulty || 'standard',
      autonomous: true,
      primarySkillId: skillId,
      scenarioId: `${scenario.family}:${scenario.id}`,
      recoveredFromFailure: result.recoveredFromFailure,
      envFingerprint,
      externalOrigins: { jobtech: 'real-snapshot-2026-10-25+scenario-gold-v1' },
    });
    processed += 1;
    if (award.awarded) {
      awarded += 1;
      xpAwarded += award.totalXpAwarded;
      if (result.recoveredFromFailure) recovered += 1;
    } else if (award.reason === 'DUPLICATE_RECEIPT') duplicates += 1;
    if (processed % 100 === 0) {
      current = tree.get(skillId);
      onProgress?.({ processed, awarded, duplicates, level: current.level, xp: current.xp, targetXp: xpForLevel(targetLevel) });
    }
  }

  // Validation passed for the complete versioned suite; record that gate only now.
  tree.setQualityGates(skillId, {
    versionedTestSuitePassed: true,
    testSuiteVersion: skill.version,
    masteryScope: {
      mastered: 'Normalizes V1/V5/Platsbanken ads, matches explicit known qualifications, uses evidence-grounded model extraction, and resumes large read-only match batches.',
      limitations: 'Unknown or ambiguous requirements remain NEEDS_REVIEW. Level 99 covers this versioned suite only; it does not guarantee every future ad, portal or occupation.',
    },
  });
  const finalSkill = tree.get(skillId);
  const finalReport = {
    ...report,
    ok: finalSkill.level >= targetLevel && (targetLevel < 99 || finalSkill.level99Evaluation?.passed !== false),
    suiteOnly: false,
    processed,
    awarded,
    duplicates,
    recovered,
    xpAwarded,
    elapsedMs: Date.now() - started,
    artifactDir,
    skill: finalSkill,
  };
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(outputDir, 'latest-report.json'), `${JSON.stringify(finalReport, null, 2)}\n`, { mode: 0o600 });
  return finalReport;
}
