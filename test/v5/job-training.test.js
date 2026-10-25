import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildJobTrainingScenarios,
  runJobTrainingScenario,
  trainJobMatching,
} from '../../src/v5/job-training.js';
import { SkillTree } from '../../src/v5/skill-tree.js';

test('job training: real JobTech corpus passes independent gold outcomes', async () => {
  const scenarios = buildJobTrainingScenarios({ syntheticCount: 0 });
  assert.equal(scenarios.length, 3);
  for (const scenario of scenarios) {
    const result = await runJobTrainingScenario(scenario);
    assert.equal(result.ok, true, `${scenario.id}: ${result.failures.join('; ')}`);
  }
});

test('job training: recovery is exercised with a fresh invalid-then-valid model response', async () => {
  const scenario = buildJobTrainingScenarios({ syntheticCount: 7 }).find((x) => x.family === 'model-recovery');
  assert.ok(scenario);
  const result = await runJobTrainingScenario(scenario);
  assert.equal(result.ok, true);
  assert.equal(result.recoveredFromFailure, true);
  assert.equal(result.actual.modelCalls, 2);
});

test('job training: validation-only run is side-effect free', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-job-suite-'));
  const report = await trainJobMatching({ dataDir, scenarios: buildJobTrainingScenarios({ syntheticCount: 90 }), suiteOnly: true });
  assert.equal(report.ok, true);
  assert.equal(report.scenariosValidated, 93);
  assert.equal(report.weightsTrained, false);
  assert.deepEqual(fs.readdirSync(dataDir), []);
});

test('job training: a wrong independent gold outcome blocks all XP', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-job-block-'));
  const scenarios = buildJobTrainingScenarios({ syntheticCount: 0 });
  scenarios[0].expected.matched = !scenarios[0].expected.matched;
  const report = await trainJobMatching({ dataDir, scenarios, targetLevel: 2 });
  assert.equal(report.ok, false);
  assert.equal(report.validationFailures.length, 1);
  const tree = new SkillTree({ dir: dataDir });
  assert.equal(tree.get('career.job-match').xp, 0);
});

test('job training: verified scenarios award XP and an existing level resumes without repeats', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-job-train-'));
  const scenarios = buildJobTrainingScenarios({ syntheticCount: 90 });
  const first = await trainJobMatching({ dataDir, scenarios, targetLevel: 10 });
  assert.equal(first.ok, true);
  assert.ok(first.skill.level >= 5);
  assert.ok(first.processed > 5);
  assert.ok(first.recovered >= 1);
  assert.equal(fs.existsSync(path.join(dataDir, 'job-training', 'latest-report.json')), true);

  const resumed = await trainJobMatching({ dataDir, scenarios, targetLevel: 5 });
  assert.equal(resumed.ok, true);
  assert.equal(resumed.processed, 0);
  assert.equal(resumed.skill.xp, first.skill.xp);
});
