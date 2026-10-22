#!/usr/bin/env node
/**
 * MAJIN V2 console entry — ties the whole stack into one honest command:
 *   majin-v2 "<objective>" --workspace <dir> [--provider-url <url> --model <m>]
 *   majin-v2 --gauntlet | --telemetry-report [dir] [--days N]
 *
 * Exit 0 only when the objective COMPLETED with verified evidence (or the
 * subsidiary command succeeded). Failed goals exit 1. Argparse: node:util
 * parseArgs (zero deps, stable since Node 20).
 */
import { parseArgs } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { runObjective } from '../src/v2/runtime/orchestrator.js';
import { runWithRecovery } from '../src/v2/recover/outer-loop.js';
import { OpenAICompatibleProvider } from '../src/v2/model/provider.js';
import { TelemetryLedger } from '../src/v2/telemetry/ledger.js';
import { loadConfig } from '../src/v2/config/config.js';
import { aggregate, renderReport } from '../src/v2/telemetry/aggregate.js';

const USAGE = `MAJIN V2
  majin-v2 "<objective>" --workspace <dir> [options]
  majin-v2 --gauntlet
  majin-v2 --telemetry-report [dir] [--days N]

Options:
  --workspace <dir>       where the objective may write (required for objectives)
  --provider-url <url>    OpenAI-compatible endpoint (e.g. opencode serve)
  --model <id>            model id at that endpoint
  --api-key <key>         optional bearer key
  --planner-model         let the planner role split builds via the model
  --recovery <class>      wrap in the bounded outer recovery loop for that failure class
  --telemetry-dir <dir>   where the JSONL ledger lives (default: <workspace>/telemetry)
  --json                  machine-readable summary
  --days N                telemetry report window (default 7)
`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    workspace: { type: 'string' },
    'provider-url': { type: 'string' },
    model: { type: 'string' },
    'api-key': { type: 'string' },
    'planner-model': { type: 'boolean' },
    recovery: { type: 'string' },
    'telemetry-dir': { type: 'string' },
    gauntlet: { type: 'boolean' },
    'telemetry-report': { type: 'string' },
    days: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});

async function main() {
  if (values.help || (!values.gauntlet && !values['telemetry-report'] && positionals.length === 0)) {
    process.stdout.write(USAGE);
    process.exit(positionals.length || values.help ? 0 : 2);
  }

  if (values.gauntlet) {
    const { runGauntlet } = await import('../src/v2/gauntlet/gauntlet.js');
    const { defaultScenarios } = await import('../src/v2/gauntlet/scenarios.js');
    const { objectiveScenarios } = await import('../src/v2/gauntlet/scenarios-objectives.js');
    const outDir = path.join(process.cwd(), 'docs', 'v2', 'gauntlet');
    const report = await runGauntlet({ scenarios: [...defaultScenarios(), ...objectiveScenarios()], outDir });
    console.log(`gauntlet: ${report.passed}/${report.scenarios} pass, verified ${(report.verifiedSuccessRate * 100).toFixed(0)}%, false success ${report.falseSuccessCount}`);
    process.exit(report.failed === 0 && report.falseSuccessCount === 0 ? 0 : 1);
  }

  if (values['telemetry-report'] !== undefined) {
    const dir = path.resolve(values['telemetry-report'] || process.cwd());
    const rep = aggregate(dir, { lastDays: Number(values.days) || 7 });
    if (values.json) console.log(JSON.stringify(rep, null, 2));
    else process.stdout.write(renderReport(rep));
    process.exit(0);
  }

  const objective = positionals.join(' ').trim();
  if (!objective) { console.error('empty objective'); process.exit(2); }
  if (!values.workspace) { console.error('--workspace is required (honest destination, never implicit)'); process.exit(2); }

  const workspaceDir = path.resolve(values.workspace);
  const { config, warnings } = loadConfig(workspaceDir);
  for (const w of warnings) console.error(`config warning: ${w}`);

  const provider = values['provider-url']
    ? new OpenAICompatibleProvider({
        name: 'cli-provider', baseUrl: values['provider-url'],
        apiKey: values['api-key'] || null, model: values.model || 'default',
      })
    : null;

  const telemetry = new TelemetryLedger(values['telemetry-dir'] ? path.resolve(values['telemetry-dir']) : path.join(workspaceDir, 'telemetry'));
  const opts = {
    workspaceDir, provider, telemetry,
    plannerWithModel: !!values['planner-model'] || config.model.plannerWithModel,
  };
  const summary = values.recovery
    ? await runWithRecovery(objective, { failureClass: values.recovery, ...opts })
    : await runObjective(objective, opts);

  const goal = summary.goal || { state: summary.finalState };
  if (values.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`goal:     ${goal.state}`);
    console.log(`compiler: ${summary.compiler?.source || '-'}${summary.compiler?.fallbackFrom ? ` (fallback: ${summary.compiler.fallbackFrom})` : ''}`);
    console.log(`planner:  ${summary.planner?.source || '-'}`);
    console.log(`produced: ${(summary.produced || []).join(', ') || '-'}`);
    console.log(`verified: ${(summary.verification || []).filter((v) => v.verified).length}/${(summary.verification || []).length} acceptance points`);
    if (summary.attempts) console.log(`attempts: ${summary.attempts} (recovered: ${summary.recovered})`);
    if (summary.reason) console.log(`reason:   ${summary.reason}`);
    console.log(`ledger:   ${telemetry.dir}`);
  }
  process.exit(goal.state === 'COMPLETED' ? 0 : 1);
}

main().catch((err) => { console.error(`majin-v2 fatal: ${err.message || err}`); process.exit(2); });
