#!/usr/bin/env node
/** Run the versioned job-match gold suite and award verified V5 skill XP. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildJobTrainingScenarios,
  trainJobMatching,
} from '../../src/v5/job-training.js';

export function parseTrainingArgs(argv = []) {
  const read = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const targetLevel = Math.max(1, Math.min(99, Number(read('--target-level', '99')) || 99));
  const syntheticCount = Math.max(0, Math.min(10000, Number(read('--synthetic-count', '3600')) || 0));
  return {
    dataDir: path.resolve(read('--data-dir', path.join(process.cwd(), '.majin', 'v5'))),
    targetLevel,
    syntheticCount,
    realCorpus: read('--real-corpus') ? path.resolve(read('--real-corpus')) : undefined,
    suiteOnly: argv.includes('--suite-only'),
    json: argv.includes('--json'),
  };
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseTrainingArgs(argv);
  const scenarios = buildJobTrainingScenarios({
    syntheticCount: options.syntheticCount,
    realCorpus: options.realCorpus,
  });
  console.log(`Validating ${scenarios.length} job-match scenarios before any XP is awarded…`);
  const report = await trainJobMatching({
    dataDir: options.dataDir,
    scenarios,
    targetLevel: options.targetLevel,
    suiteOnly: options.suiteOnly,
    onProgress: ({ processed, level, xp, targetXp }) => {
      if (!options.json) console.log(`verified=${processed} level=${level}/99 xp=${xp}/${targetXp}`);
    },
  });
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else if (!report.ok) {
    console.error(`FAILED: ${report.validationFailures?.length || 1} scenario failure(s). No Level 99 claim was made.`);
    for (const failure of (report.validationFailures || [report.trainingFailure]).slice(0, 10)) {
      console.error(`${failure.scenarioId}: ${failure.failures.join('; ')}`);
    }
  } else if (options.suiteOnly) {
    console.log(`PASS: ${report.scenariosValidated} scenarios · ${report.realAds} real ads · ${report.syntheticAds} synthetic ads · ${report.elapsedMs} ms`);
  } else {
    console.log([
      `${report.ok ? 'PASS' : 'FAIL'}: career.job-match ${report.skill.level}/99 · ${report.skill.xp} XP`,
      `${report.scenariosValidated} gold scenarios · ${report.realAds} real JobTech ads · ${report.syntheticAds} synthetic ads`,
      `${report.awarded} XP awards · ${report.duplicates} resumable duplicates · ${report.recovered} verified recoveries`,
      `Report: ${path.join(options.dataDir, 'job-training', 'latest-report.json')}`,
      'Model weights changed: no (verified procedural skill progression only).',
    ].join('\n'));
  }
  if (!report.ok) process.exitCode = 1;
  return report;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
}
