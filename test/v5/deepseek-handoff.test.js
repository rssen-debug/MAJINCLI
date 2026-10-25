import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deepSeekGateFailures,
  loadProductionAds,
} from '../../scripts/v5/run-deepseek-jobs.mjs';
import { REAL_JOB_CORPUS } from '../../src/v5/job-training.js';

const READY_SKILL = {
  canonical_id: 'career.job-match',
  level: 99,
  level99Evaluation: { passed: true, gates: { versionedTestSuite: true } },
};
const READY_PROVIDER = {
  activeProvider: 'deepseek',
  activeModelId: 'deepseek-chat',
  lastVerifiedModelId: 'deepseek-chat',
  savedConfig: true,
  connectionVerified: true,
  fallbackPolicy: { allowPaidFallback: false, allowDataSharingFallback: false },
};

test('DeepSeek handoff accepts only a Level-99 skill and the exact verified DeepSeek model', () => {
  assert.deepEqual(deepSeekGateFailures({ skill: READY_SKILL, provider: READY_PROVIDER }), []);
  assert.ok(deepSeekGateFailures({ skill: { ...READY_SKILL, level: 98 }, provider: READY_PROVIDER }).some((x) => x.includes('Level 99')));
  assert.ok(deepSeekGateFailures({ skill: READY_SKILL, provider: { ...READY_PROVIDER, activeProvider: 'opencode-go' } }).some((x) => x.includes('not DeepSeek')));
  assert.ok(deepSeekGateFailures({ skill: READY_SKILL, provider: { ...READY_PROVIDER, connectionVerified: false } }).some((x) => x.includes('not verified')));
  assert.ok(deepSeekGateFailures({ skill: READY_SKILL, provider: { ...READY_PROVIDER, activeModelId: 'deepseek-reasoner' } }).some((x) => x.includes('connection-verified model')));
  assert.ok(deepSeekGateFailures({ skill: READY_SKILL, provider: { ...READY_PROVIDER, fallbackPolicy: { ...READY_PROVIDER.fallbackPolicy, allowPaidFallback: true } } }).some((x) => x.includes('paid fallback')));
});

test('DeepSeek production loader accepts real corpus and JobTech search shapes without a provider call', () => {
  assert.equal(loadProductionAds(REAL_JOB_CORPUS).length, 3);
});
