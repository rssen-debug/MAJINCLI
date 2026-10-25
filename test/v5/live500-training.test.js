import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLive500TrainingScenarios } from '../../src/v5/live500-training.js';
import { trainJobMatching } from '../../src/v5/job-training.js';

test('real-500 independent source oracle covers every ad and pins the honest outcome', () => {
  const scenarios = buildLive500TrainingScenarios();
  assert.equal(scenarios.length, 500);
  assert.ok(scenarios.every((scenario) => scenario.synthetic === false));
  assert.equal(scenarios.filter((scenario) => scenario.expected.matched).length, 61);
  assert.equal(scenarios.filter((scenario) => scenario.expected.needsReview).length, 438);
  assert.equal(scenarios.filter((scenario) => !scenario.expected.matched && !scenario.expected.needsReview).length, 1);
  const nonMatch = scenarios.find((scenario) => !scenario.expected.matched && !scenario.expected.needsReview);
  assert.deepEqual(nonMatch.expected.requiredMissing, ['danska', 'norska']); // input vocabulary, never rendered
  assert.ok(scenarios.some((scenario) => scenario.family === 'real500-preferred-only'));
  assert.ok(scenarios.some((scenario) => scenario.family === 'real500-unresolved-required'));
});

test('real-500 suite passes before any retraining XP is awarded', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-real500-suite-'));
  const scenarios = buildLive500TrainingScenarios();
  const report = await trainJobMatching({ dataDir, scenarios, suiteOnly: true });
  assert.equal(report.ok, true, JSON.stringify(report.validationFailures?.slice(0, 3)));
  assert.equal(report.scenariosValidated, 500);
  assert.equal(report.realAds, 500);
  assert.equal(report.syntheticAds, 0);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});
