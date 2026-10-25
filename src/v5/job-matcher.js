/**
 * MAJIN V5 — grounded model-assisted job matching.
 *
 * The model structures an ad; it never decides whether the applicant qualifies.
 * Every model-supplied requirement needs an exact evidence quote from that ad.
 * CV facts and matching stay local, so DeepSeek does not need personal CV data.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  canonicalSkillName,
  evidenceOccursInAd,
  hasStructuredRequirements,
  normalizeJobAd,
} from './job-ad.js';
import { deduplicateJobListings, evaluateJobMatch } from './workflows/job-search.js';

export const JOB_EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  required: ['requiredSkills', 'preferredSkills', 'minExperienceYears', 'noRequirements'],
  properties: {
    requiredSkills: { type: 'array', items: { type: 'object', required: ['name', 'evidence'] } },
    preferredSkills: { type: 'array', items: { type: 'object', required: ['name', 'evidence'] } },
    minExperienceYears: { type: ['number', 'null'], minimum: 0, maximum: 50 },
    experienceEvidence: { type: ['string', 'null'] },
    noRequirements: { type: 'boolean' },
    noRequirementsEvidence: { type: ['string', 'null'] },
  },
});

export class JobExtractionError extends Error {
  constructor(message, { code = 'INVALID_MODEL_EXTRACTION', attempts = 1, cause = null } = {}) {
    super(message);
    this.name = 'JobExtractionError';
    this.code = code;
    this.attempts = attempts;
    this.cause = cause;
  }
}

export function buildRequirementExtractionPrompt(inputAd = {}) {
  const ad = normalizeJobAd(inputAd);
  const system = [
    'You structure job advertisements. Return one JSON object and no markdown.',
    'Extract only qualifications explicitly stated by the advertisement.',
    'requiredSkills are mandatory; preferredSkills are merely desirable. Never swap those groups.',
    'Every skill must be {name, evidence}, where evidence is a short exact quote from the advertisement.',
    'Do not infer licenses, education, years, languages, permits or certificates from a job title.',
    'Use minExperienceYears only for an explicit numeric minimum; otherwise null and experienceEvidence null.',
    'Set noRequirements true only when the ad explicitly says there are no qualification requirements, with exact evidence.',
    'If requirements are absent or ambiguous, return empty arrays and noRequirements false. Do not guess.',
    `JSON shape: ${JSON.stringify(JOB_EXTRACTION_SCHEMA)}`,
  ].join('\n');
  const user = JSON.stringify({
    title: ad.title,
    description: ad.description,
    existingRequiredLabels: ad.requiredSkills,
    existingPreferredLabels: ad.preferredSkills,
  });
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function parseJsonObject(text) {
  const raw = String(text || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON object in model response');
  return JSON.parse(raw.slice(start, end + 1));
}

function modelText(result) {
  if (typeof result === 'string') return result;
  if (result?.ok === false) {
    const err = new Error(result.error?.message || 'Model call failed');
    err.code = result.error?.code || 'MODEL_FAILURE';
    throw err;
  }
  return result?.response?.text
    ?? result?.response?.content
    ?? result?.text
    ?? result?.content
    ?? result?.choices?.[0]?.message?.content
    ?? '';
}

function groundedEntries(value, ad, field) {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (value.length > 40) throw new Error(`${field} has too many entries`);
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${field} entries must contain name and evidence`);
    }
    const name = String(item.name || '').trim();
    const evidence = String(item.evidence || '').trim();
    if (!name || name.length > 120) throw new Error(`${field} contains an invalid skill name`);
    if (!evidence || evidence.length > 600 || !evidenceOccursInAd(evidence, ad)) {
      throw new Error(`${field} contains evidence not found in the advertisement: ${name}`);
    }
    const canonical = canonicalSkillName(name);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ name, canonical, evidence });
  }
  return out;
}

/** Validate model output against both the schema and the source advertisement. */
export function parseGroundedExtraction(text, inputAd = {}) {
  const ad = normalizeJobAd(inputAd);
  let body;
  try {
    body = parseJsonObject(text);
  } catch (err) {
    throw new JobExtractionError(`Invalid extraction JSON: ${err.message}`, { code: 'INVALID_MODEL_JSON', cause: err });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new JobExtractionError('Extraction must be a JSON object');
  }
  try {
    const requiredSkills = groundedEntries(body.requiredSkills, ad, 'requiredSkills');
    const preferredSkills = groundedEntries(body.preferredSkills, ad, 'preferredSkills');
    const minExperienceYears = body.minExperienceYears == null ? null : Number(body.minExperienceYears);
    if (minExperienceYears !== null && (!Number.isInteger(minExperienceYears) || minExperienceYears < 0 || minExperienceYears > 50)) {
      throw new Error('minExperienceYears must be an integer from 0 to 50 or null');
    }
    if (minExperienceYears > 0 && !evidenceOccursInAd(body.experienceEvidence, ad)) {
      throw new Error('Experience minimum lacks exact source evidence');
    }
    if (typeof body.noRequirements !== 'boolean') throw new Error('noRequirements must be boolean');
    if (body.noRequirements && !evidenceOccursInAd(body.noRequirementsEvidence, ad)) {
      throw new Error('noRequirements lacks exact source evidence');
    }
    if (body.noRequirements && (requiredSkills.length || preferredSkills.length || minExperienceYears > 0)) {
      throw new Error('noRequirements conflicts with extracted qualifications');
    }
    return {
      requiredSkills,
      preferredSkills,
      minExperienceYears,
      experienceEvidence: minExperienceYears > 0 ? String(body.experienceEvidence).trim() : null,
      noRequirements: body.noRequirements,
      noRequirementsEvidence: body.noRequirements ? String(body.noRequirementsEvidence).trim() : null,
    };
  } catch (err) {
    if (err instanceof JobExtractionError) throw err;
    throw new JobExtractionError(err.message, { code: 'UNGROUNDED_MODEL_EXTRACTION', cause: err });
  }
}

/**
 * Build an extractor around any V1/V5-compatible completion function. Invalid
 * JSON or ungrounded evidence is retried bounded times and never accepted.
 */
export function createRequirementExtractor({ complete, maxAttempts = 2 } = {}) {
  if (typeof complete !== 'function') throw new Error('createRequirementExtractor requires complete()');
  return async function extract(inputAd, { signal = null, sessionId = 'job-match' } = {}) {
    const ad = normalizeJobAd(inputAd);
    const messages = buildRequirementExtractionPrompt(ad);
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt += 1) {
      try {
        const result = await complete({
          messages,
          signal,
          sessionId: `${sessionId}:${ad.id}`,
          maxTokens: 1400,
          temperature: 0,
          maxRetries: 1,
        });
        const parsed = parseGroundedExtraction(modelText(result), ad);
        return { ...parsed, modelCalls: attempt, recoveredFromFailure: attempt > 1 };
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError instanceof JobExtractionError) {
      lastError.attempts = Math.max(1, maxAttempts);
      throw lastError;
    }
    throw new JobExtractionError(lastError?.message || 'Requirement extraction failed', {
      code: lastError?.code || 'MODEL_FAILURE',
      attempts: Math.max(1, maxAttempts),
      cause: lastError,
    });
  };
}

/**
 * Match one ad. Structured tags need no paid model call. Unstructured ads use
 * grounded model extraction when available, otherwise remain NEEDS_REVIEW.
 */
export async function matchJobAd({ ad: inputAd, cvFacts, criteria = {}, complete = null, maxAttempts = 2, signal = null, sessionId = 'job-match' } = {}) {
  const ad = normalizeJobAd(inputAd);
  const structured = hasStructuredRequirements(ad);
  if (typeof complete !== 'function' || ad.noRequirements || (structured && !ad.description.trim())) {
    const result = evaluateJobMatch(ad, cvFacts, criteria);
    return {
      ...result,
      jobId: ad.id,
      provenance: structured ? 'structured' : (ad.noRequirements ? 'declared-no-requirements' : 'unreviewed'),
      modelCalls: 0,
      recoveredFromFailure: false,
    };
  }

  try {
    const extract = createRequirementExtractor({ complete, maxAttempts });
    const extracted = await extract(ad, { signal, sessionId });
    const requiredNames = [...ad.requiredSkills, ...extracted.requiredSkills.map((x) => x.name)];
    const requiredCanonical = new Set(requiredNames.map(canonicalSkillName));
    const preferredNames = [...ad.preferredSkills, ...extracted.preferredSkills.map((x) => x.name)]
      .filter((name) => !requiredCanonical.has(canonicalSkillName(name)));
    const enriched = {
      ...ad,
      requiredSkills: requiredNames,
      preferredSkills: preferredNames,
      minExperienceYears: extracted.minExperienceYears,
      noRequirements: extracted.noRequirements,
      requirementsSource: structured ? 'structured+model' : 'model',
    };
    const result = evaluateJobMatch(enriched, cvFacts, criteria);
    return {
      ...result,
      jobId: ad.id,
      provenance: structured ? 'structured+model-grounded' : 'model-grounded',
      modelCalls: extracted.modelCalls,
      recoveredFromFailure: extracted.recoveredFromFailure,
      extraction: extracted,
    };
  } catch (err) {
    const fallback = evaluateJobMatch({ ...ad, noRequirements: false }, cvFacts, criteria);
    return {
      ...fallback,
      matched: false,
      needsReview: true,
      score: null,
      jobId: ad.id,
      provenance: 'model-failed-needs-review',
      modelCalls: Number(err?.attempts) || maxAttempts,
      recoveredFromFailure: false,
      modelError: { code: err?.code || 'MODEL_FAILURE', message: String(err?.message || err).slice(0, 300) },
    };
  }
}

/** Use V5's selected provider without leaking ProviderManager internals to callers. */
export function createProviderJobMatcher(providers) {
  return async ({ ad, cvFacts, criteria = {}, signal = null, sessionId = 'job-match' } = {}) => {
    const selected = Boolean(providers?.state?.activeProvider && providers?.state?.activeModelId);
    const complete = selected ? (request) => providers.complete(request) : null;
    const result = await matchJobAd({ ad, cvFacts, criteria, complete, signal, sessionId });
    return {
      ...result,
      providerId: result.modelCalls > 0 ? providers.state.activeProvider : null,
      modelId: result.modelCalls > 0 ? providers.state.activeModelId : null,
    };
  };
}

function stableRunId(value) {
  const clean = String(value || 'job-match').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  if (!clean) throw new Error('runId must contain letters or numbers');
  return clean;
}

function criteriaHash(cvFacts, criteria) {
  return crypto.createHash('sha256').update(JSON.stringify({ cvFacts, criteria })).digest('hex');
}

/**
 * Durable, resumable batch matching for large ad sets. This path searches and
 * matches only; it never prepares or submits applications and has no 500-ad cap.
 */
export class JobMatchBatch {
  constructor({ dataDir, matcher, concurrency = 4 } = {}) {
    if (!dataDir) throw new Error('JobMatchBatch requires dataDir');
    if (typeof matcher !== 'function') throw new Error('JobMatchBatch requires matcher');
    this.dir = path.join(dataDir, 'job-match-runs');
    this.matcher = matcher;
    this.concurrency = Math.max(1, Math.min(16, Number(concurrency) || 4));
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  paths(runId) {
    const id = stableRunId(runId);
    return { id, meta: path.join(this.dir, `${id}.meta.json`), results: path.join(this.dir, `${id}.jsonl`) };
  }

  readResults(file) {
    if (!fs.existsSync(file)) return [];
    const rows = [];
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* ignore a torn final line on resume */ }
    }
    return rows;
  }

  async run({ runId = 'job-match', ads = [], cvFacts = {}, criteria = {}, signal = null, onProgress = null } = {}) {
    const files = this.paths(runId);
    const inputHash = criteriaHash(cvFacts, criteria);
    if (fs.existsSync(files.meta)) {
      const meta = JSON.parse(fs.readFileSync(files.meta, 'utf8'));
      if (meta.inputHash !== inputHash) throw new Error('Cannot resume a run with a different CV or criteria; choose a new runId');
    } else {
      const tmp = `${files.meta}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify({ schema: 'majin.v5.job-match-run/v1', runId: files.id, inputHash, createdAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(tmp, files.meta);
    }

    const deduped = deduplicateJobListings(ads);
    const previous = this.readResults(files.results);
    const latest = new Map(previous.map((row) => [row.jobId, row]));
    // Transport/unexpected errors are retryable on a later run. Grounded
    // NEEDS_REVIEW outcomes are final and must not cause another paid call.
    const done = new Map([...latest].filter(([, row]) => !(row.provenance === 'error' && row.retryable === true)));
    const resumedCount = deduped.unique.filter((ad) => done.has(ad.id)).length;
    const pending = deduped.unique.filter((ad) => !done.has(ad.id));
    let cursor = 0;
    let completed = resumedCount;
    const worker = async () => {
      while (cursor < pending.length) {
        if (signal?.aborted) return;
        const ad = pending[cursor];
        cursor += 1;
        try {
          const result = await this.matcher({ ad, cvFacts, criteria, signal, sessionId: `${files.id}:${ad.id}` });
          if (signal?.aborted) return;
          const row = { jobId: ad.id, title: ad.title, employer: ad.employer, location: ad.location, url: ad.url, ...result, at: new Date().toISOString() };
          fs.appendFileSync(files.results, `${JSON.stringify(row)}\n`, { mode: 0o600 });
          done.set(ad.id, row);
          completed += 1;
          onProgress?.({ completed, total: deduped.unique.length, result: row });
        } catch (err) {
          const row = { jobId: ad.id, matched: false, needsReview: true, provenance: 'error', retryable: true, error: String(err?.message || err).slice(0, 300), at: new Date().toISOString() };
          fs.appendFileSync(files.results, `${JSON.stringify(row)}\n`, { mode: 0o600 });
          done.set(ad.id, row);
          completed += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, Math.max(1, pending.length)) }, worker));
    const results = deduped.unique.map((ad) => done.get(ad.id)).filter(Boolean);
    return {
      runId: files.id,
      file: files.results,
      found: deduped.foundCount,
      unique: deduped.uniqueCount,
      duplicates: deduped.duplicateCount,
      resumed: resumedCount,
      processed: pending.length,
      completed: results.length,
      cancelled: Boolean(signal?.aborted),
      matched: results.filter((r) => r.matched === true).length,
      unmatched: results.filter((r) => r.matched === false && !r.needsReview).length,
      needsReview: results.filter((r) => r.needsReview === true).length,
      errors: results.filter((r) => r.provenance === 'error').length,
      modelGrounded: results.filter((r) => String(r.provenance || '').includes('model-grounded')).length,
      recovered: results.filter((r) => r.recoveredFromFailure === true).length,
      results,
    };
  }
}
