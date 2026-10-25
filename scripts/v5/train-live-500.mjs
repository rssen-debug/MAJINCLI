#!/usr/bin/env node
/** Retrain V5 from a fresh state with 500 real ads plus generated variations. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJobTrainingScenarios, trainJobMatching } from '../../src/v5/job-training.js';
import { buildLive500TrainingScenarios } from '../../src/v5/live500-training.js';

export async function main(argv = process.argv.slice(2)) {
  const read = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const dataDir = path.resolve(read('--data-dir', path.join(process.cwd(), '.majin', 'v5-real500')));
  const targetLevel = Math.max(1, Math.min(99, Number(read('--target-level', '99')) || 99));
  const syntheticCount = Math.max(0, Math.min(10000, Number(read('--synthetic-count', '3600')) || 0));
  const suiteOnly = argv.includes('--suite-only');
  const real = buildLive500TrainingScenarios();
  const synthetic = buildJobTrainingScenarios({ syntheticCount }).filter((scenario) => scenario.synthetic !== false);
  const scenarios = [...real, ...synthetic];
  console.log(`Real-500 retraining: validating ${scenarios.length} scenarios (${real.length} real + ${synthetic.length} synthetic) before XP…`);
  const report = await trainJobMatching({
    dataDir,
    scenarios,
    targetLevel,
    suiteOnly,
    onProgress: ({ processed, level, xp }) => {
      if (processed % 250 === 0) console.log(`verified=${processed} level=${level}/99 xp=${xp}`);
    },
  });
  console.log(JSON.stringify({
    ok: report.ok,
    suiteOnly: report.suiteOnly,
    scenariosValidated: report.scenariosValidated,
    realAds: report.realAds,
    syntheticAds: report.syntheticAds,
    validationFailures: report.validationFailures?.slice(0, 10),
    trainingFailure: report.trainingFailure || null,
    processed: report.processed,
    awarded: report.awarded,
    recovered: report.recovered,
    level: report.skill?.level,
    xp: report.skill?.xp,
    dataDir,
  }, null, 2));
  if (!report.ok) process.exitCode = 1;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
}
