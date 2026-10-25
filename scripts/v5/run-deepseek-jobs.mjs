#!/usr/bin/env node
/**
 * Gated DeepSeek handoff. No production batch is opened until Level 99,
 * provider verification and three real-ad canaries have all passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GrandArchitect } from '../../src/v5/architect.js';
import { createProviderJobMatcher, JobMatchBatch } from '../../src/v5/job-matcher.js';
import {
  loadRealJobScenarios,
  validateJobMatchResult,
  JOB_TRAINING_SUITE_VERSION,
} from '../../src/v5/job-training.js';

export function deepSeekGateFailures({ skill, provider }) {
  const failures = [];
  if (!skill || skill.canonical_id !== 'career.job-match') failures.push('missing career.job-match skill');
  else {
    if (skill.level !== 99 || skill.level99Evaluation?.passed !== true) failures.push('career.job-match must pass all Level 99 gates');
    if (!skill.level99Evaluation?.gates?.versionedTestSuite) failures.push('versioned test-suite gate is not satisfied');
  }
  if (provider?.activeProvider !== 'deepseek') failures.push('active provider is not DeepSeek');
  if (!provider?.activeModelId) failures.push('no active DeepSeek model');
  if (provider?.savedConfig !== true) failures.push('DeepSeek configuration is not saved');
  if (provider?.connectionVerified !== true) failures.push('DeepSeek connection is not verified');
  if (provider?.lastVerifiedModelId !== provider?.activeModelId) failures.push('the active model is not the connection-verified model');
  if (provider?.fallbackPolicy?.allowPaidFallback !== false) failures.push('paid fallback must be disabled');
  if (provider?.fallbackPolicy?.allowDataSharingFallback !== false) failures.push('data-sharing fallback must be disabled');
  return failures;
}

function readStructuredFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.jsonl')) return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
  return JSON.parse(text);
}

export function loadProductionAds(file) {
  const body = readStructuredFile(file);
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.hits)) return body.hits;
  if (Array.isArray(body?.cases)) return body.cases.map((item) => item.ad);
  throw new Error('Production input must be an ad array, JobTech search response, corpus cases, or JSONL ads');
}

async function runRealAdCanary(matcher) {
  const scenarios = loadRealJobScenarios();
  const results = [];
  for (const scenario of scenarios) {
    const actual = await matcher({
      ad: scenario.ad,
      cvFacts: scenario.cvFacts,
      criteria: scenario.criteria || {},
      sessionId: `deepseek-canary:${scenario.id}`,
    });
    // Required outcomes are strict; optional preferred labels may legitimately
    // vary when a model discovers another explicit merit in the real prose.
    const expected = {
      matched: scenario.expected.matched,
      needsReview: scenario.expected.needsReview,
      ...(scenario.expected.requiredMissing ? { requiredMissing: scenario.expected.requiredMissing } : {}),
    };
    const failures = validateJobMatchResult(expected, actual);
    if (actual.providerId !== 'deepseek') failures.push(`provider: expected deepseek, got ${actual.providerId}`);
    if (!(actual.modelCalls > 0)) failures.push('canary made no real model call');
    results.push({
      scenarioId: scenario.id,
      ok: failures.length === 0,
      failures,
      matched: actual.matched,
      needsReview: actual.needsReview,
      provenance: actual.provenance,
      modelCalls: actual.modelCalls,
    });
  }
  return { ok: results.every((result) => result.ok), results };
}

export async function runGatedDeepSeekJobs({
  dataDir,
  production = false,
  inputFile = null,
  cvFile = null,
  runId = 'deepseek-production',
  limit = 0,
  concurrency = 4,
} = {}) {
  if (!dataDir) throw new Error('dataDir is required');
  const architect = new GrandArchitect({ dataDir, workspaceDir: process.cwd() });
  const skill = architect.skillTree.list().find((item) => item.canonical_id === 'career.job-match');
  const provider = architect.providers.getPublicState();
  const gateFailures = deepSeekGateFailures({ skill, provider });
  const report = {
    schema: 'majin.v5.deepseek-handoff-report/v1',
    suiteVersion: JOB_TRAINING_SUITE_VERSION,
    productionRequested: production,
    applicationSubmissions: 0,
    provider: { id: provider.activeProvider, modelId: provider.activeModelId, connectionVerified: provider.connectionVerified },
    skill: skill ? { level: skill.level, xp: skill.xp, level99Passed: skill.level99Evaluation?.passed === true } : null,
    gateFailures,
  };
  if (gateFailures.length) return { ...report, ok: false, blockedBeforeModelCall: true };

  const matcher = createProviderJobMatcher(architect.providers);
  const canary = await runRealAdCanary(matcher);
  report.canary = canary;
  if (!canary.ok) return { ...report, ok: false, blockedBeforeProduction: true };
  if (!production) return { ...report, ok: true, readyForProduction: true };
  if (!inputFile || !cvFile) {
    return { ...report, ok: false, blockedBeforeProduction: true, productionFailures: ['--input and --cv are required for production'] };
  }

  let ads = loadProductionAds(inputFile);
  if (limit > 0) ads = ads.slice(0, Math.max(1, Math.floor(limit)));
  const cvBody = readStructuredFile(cvFile);
  const cvFacts = cvBody.cvFacts || cvBody;
  const criteria = cvBody.criteria || {};
  const batch = new JobMatchBatch({ dataDir, matcher, concurrency });
  const batchReport = await batch.run({ runId, ads, cvFacts, criteria });
  report.batch = {
    runId: batchReport.runId,
    file: batchReport.file,
    found: batchReport.found,
    unique: batchReport.unique,
    duplicates: batchReport.duplicates,
    resumed: batchReport.resumed,
    processed: batchReport.processed,
    completed: batchReport.completed,
    matched: batchReport.matched,
    unmatched: batchReport.unmatched,
    needsReview: batchReport.needsReview,
    errors: batchReport.errors,
    modelGrounded: batchReport.modelGrounded,
    recovered: batchReport.recovered,
  };
  report.ok = batchReport.completed === batchReport.unique && batchReport.errors === 0;
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const read = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const dataDir = path.resolve(read('--data-dir', path.join(process.cwd(), '.majin', 'v5')));
  const report = await runGatedDeepSeekJobs({
    dataDir,
    production: argv.includes('--production'),
    inputFile: read('--input') ? path.resolve(read('--input')) : null,
    cvFile: read('--cv') ? path.resolve(read('--cv')) : null,
    runId: read('--run-id', 'deepseek-production'),
    limit: Number(read('--limit', '0')),
    concurrency: Number(read('--concurrency', '4')),
  });
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'deepseek-handoff-latest.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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
