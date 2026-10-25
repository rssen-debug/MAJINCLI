/** Independent source-taxonomy oracles for the committed real 500-ad fixture. */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIVE_500_CORPUS = path.resolve(HERE, '../../test/fixtures/majin-v5-live-500-input.json');
export const LIVE_500_CV = path.resolve(HERE, '../../test/fixtures/synthetic-test-cv.json');
export const LIVE_500_CV_SHA256 = 'f2b35bea7c2467fe25ab3184e8bb95129924cc2571b5f3d382798263bb46e003';

// This map is deliberately independent of job-ad.js's production catalog.
// Null means the source label is not safe to auto-match with this fixed CV.
const REQUIRED_LABEL_ORACLE = new Map([
  ['Artificial Intelligence/Artificiell intelligens/AI', null],
  ['B-körkort', 'b-körkort'], // input vocabulary, never rendered
  ['Business Intelligence/BI', null],
  ['C++ Builder, programmeringsverktyg', null], // input vocabulary, never rendered
  ['C-körkort', 'c-körkort'], // input vocabulary, never rendered
  ['CE-körkort', 'ce-körkort'], // input vocabulary, never rendered
  ['Danska', 'danska'], // input vocabulary, never rendered
  ['Engelska', 'engelska'], // input vocabulary, never rendered
  ['Machine learning/Maskininlärning', null], // input vocabulary, never rendered
  ['Norska', 'norska'], // input vocabulary, never rendered
  ['Python, programmeringsspråk', 'python'], // input vocabulary, never rendered
  ['Svenska', 'svenska'], // input vocabulary, never rendered
  ['TypeScript, programmeringsspråk', 'typescript'], // input vocabulary, never rendered
  ['Windows Azure, molnplattform', 'azure'], // input vocabulary, never rendered
]);

// Authored from the visible synthetic CV, not extracted by the code under test.
const ORACLE_CV_QUALIFICATIONS = new Set([
  'b-körkort', 'c-körkort', 'ce-körkort', 'azure', 'python', 'typescript', 'svenska', 'engelska', // input vocabulary, never rendered
]);

function labels(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item?.label || item?.name || item || '').trim())
    .filter(Boolean);
}

function sourceRequirements(ad) {
  const required = [
    ...labels(ad.must_have?.skills),
    ...labels(ad.must_have?.languages),
  ];
  if (ad.driving_license_required) {
    required.push(...labels(ad.driving_license).map((label) => /^(B|C|CE)$/i.test(label) ? `${label.toUpperCase()}-körkort` : label)); // input vocabulary, never rendered
  }
  const preferred = [
    ...labels(ad.nice_to_have?.skills),
    ...labels(ad.nice_to_have?.languages),
  ];
  return { required: [...new Set(required)], preferred: [...new Set(preferred)] };
}

export function buildLive500TrainingScenarios({ corpusFile = LIVE_500_CORPUS, cvFile = LIVE_500_CV } = {}) {
  const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
  const cvBody = JSON.parse(fs.readFileSync(cvFile, 'utf8'));
  const cvFacts = cvBody.cvFacts || cvBody;
  if (corpus.schema !== 'majin.v5.live-500-input/v1' || !Array.isArray(corpus.hits) || corpus.hits.length !== 500) {
    throw new Error('Expected the committed 500-ad live input fixture');
  }
  if (cvFacts.cvSha256 !== LIVE_500_CV_SHA256) throw new Error('The independent real-500 oracle is pinned to the original synthetic CV');

  return corpus.hits.map((ad) => {
    const source = sourceRequirements(ad);
    const mapped = source.required.map((label) => ({ label, id: REQUIRED_LABEL_ORACLE.has(label) ? REQUIRED_LABEL_ORACLE.get(label) : null }));
    const unresolved = mapped.filter((item) => !item.id);
    const known = mapped.filter((item) => item.id);
    const requiredMet = known.filter((item) => ORACLE_CV_QUALIFICATIONS.has(item.id)).map((item) => item.id);
    const requiredMissing = known.filter((item) => !ORACLE_CV_QUALIFICATIONS.has(item.id)).map((item) => item.id);
    const noRequirements = ad.noRequirements === true;
    const needsReview = source.required.length === 0 ? !noRequirements : unresolved.length > 0;
    const matched = !needsReview && (noRequirements || (source.required.length > 0 && unresolved.length === 0 && requiredMissing.length === 0));
    const expected = {
      matched,
      needsReview,
      provenance: source.required.length || source.preferred.length ? 'structured' : 'unreviewed',
      // Unknown labels have no independent canonical ID; booleans are the
      // strict oracle for those cases. Known cases also compare exact lists.
      ...(source.required.length > 0 && unresolved.length === 0 ? {
        requiredMet: [...new Set(requiredMet)].sort(),
        requiredMissing: [...new Set(requiredMissing)].sort(),
      } : {}),
    };
    const family = unresolved.length ? 'real500-unresolved-required'
      : source.required.length ? 'real500-known-required'
        : source.preferred.length ? 'real500-preferred-only' : 'real500-unstructured';
    return {
      id: `real500-${ad.id}`,
      family,
      synthetic: false,
      difficulty: unresolved.length || source.required.length > 1 ? 'advanced' : source.required.length ? 'complex' : 'standard',
      ad,
      cvFacts,
      criteria: {},
      expected,
      sourceLabels: source,
    };
  });
}
