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
import { resolveProfile } from '../src/v2/model/profiles.js';
import { aggregate, renderReport } from '../src/v2/telemetry/aggregate.js';
import { AuditChain } from '../src/v2/audit/chain.js';

const USAGE = `MAJIN V2
  majin-v2 "<objective>" --workspace <dir> [options]
  majin-v2 --gauntlet
  majin-v2 --telemetry-report [dir] [--days N]
  majin-v2 --audit-verify <dir>
  majin-v2 --studio [--port N] [--host H] [--telemetry-dir D] [--audit-dir D] [--enable-writes]

Options:
  --workspace <dir>       where the objective may write (required for objectives)
  --profile <name>        provider preset: opencode-go | opencode-zen | opencode-local
                          (key comes ONLY from env var, e.g. OPENCODE_API_KEY — never args)
  --provider-url <url>    OpenAI-compatible endpoint (e.g. opencode serve)
  --model <id>            model id at that endpoint
  --api-key <key>         optional bearer key
  --planner-model         let the planner role split builds via the model
  --recovery <class>      wrap in the bounded outer recovery loop for that failure class
  --telemetry-dir <dir>   where the JSONL ledger lives (default: <workspace>/telemetry)
  --json                  machine-readable summary
  --days N                telemetry report window (default 7)
`;

let values, positionals;
try {
  ({ values, positionals } = parseArgs({
  options: {
    workspace: { type: 'string' },
    profile: { type: 'string' },
    'provider-url': { type: 'string' },
    model: { type: 'string' },
    'api-key': { type: 'string' },
    'planner-model': { type: 'boolean' },
    recovery: { type: 'string' },
    'telemetry-dir': { type: 'string' },
    gauntlet: { type: 'boolean' },
    'telemetry-report': { type: 'string' },
    'audit-verify': { type: 'string' },
    studio: { type: 'boolean' },
    'enable-writes': { type: 'boolean' },
    port: { type: 'string' },
    host: { type: 'string' },
    'audit-dir': { type: 'string' },
    days: { type: 'string' },
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
  allowPositionals: true,
  }));
} catch (err) {
  // misuse is exit 2, never a crash — same contract as a missing --workspace
  console.error(`majin-v2: ${err.message}`);
  process.stdout.write(USAGE);
  process.exit(2);
}

async function main() {
  if (values.help || (!values.gauntlet && !values['telemetry-report'] && values['audit-verify'] === undefined && !values.studio && positionals.length === 0)) {
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

  if (values['audit-verify'] !== undefined) {
    // independent verifier: fresh AuditChain instance, full walk + anchor check.
    // AUDIT ok | AUDIT broken — no adjectives, machine-parseable (prior-art CLI shape).
    const dir = path.resolve(values['audit-verify']);
    if (!values['audit-verify']) {
      console.error('AUDIT broken LINE=- REASON=USAGE (--audit-verify requires a directory)');
      process.exit(2);
    }
    let verdict;
    try {
      verdict = new AuditChain(dir).verify();
    } catch (err) {
      // constructor-level fork/anchor disagreement is a broken verdict, not a crash
      console.error(`AUDIT broken LINE=- REASON=${err.cls || 'FAILED'} (${err.message})`);
      process.exit(1);
    }
    if (verdict.ok) {
      console.log(`AUDIT ok ENTRIES=${verdict.entries} HEAD=${verdict.head.slice(0, 16)}`);
      process.exit(0);
    }
    console.error(`AUDIT broken LINE=${verdict.brokenAt} REASON=${verdict.reason} (${verdict.detail})`);
    process.exit(1);
  }

    if (values.studio) {
    const { createStudioServer } = await import('../src/v2/studio/server.js');
    const { EventBus } = await import('../src/v2/runtime/events.js');
    const bus = new EventBus();
    const telemetryDir = path.resolve(values['telemetry-dir'] || 'telemetry');
    const auditDir = path.resolve(values['audit-dir'] || 'audit');
    let approvals = null;
    let auditBind = null;
    if (values['enable-writes']) {
      // consent write surface: real Approvals as the only authority, every
      // decision mirrored into the tamper-evident chain via the real bus
      const { Approvals } = await import('../src/v2/safety/approvals.js');
      const { AuditChain } = await import('../src/v2/audit/chain.js');
      const { AuditBind } = await import('../src/v2/audit/bind.js');
      approvals = new Approvals(bus);
      auditBind = new AuditBind(new AuditChain(auditDir));
      auditBind.attach(bus);
    }
    const studio = createStudioServer({ bus, telemetryDir, auditDir, approvals, enableWrites: values['enable-writes'] });
    const bound = await studio.listen({ port: Number(values.port) || 0, host: values.host || '127.0.0.1' });
    console.log(`MAJIN V2 Studio ${values['enable-writes'] ? '(consent writes ENABLED — every grant/revoke audit-chained)' : '(read-only scaffold)'} at ${bound.url}`);
    console.log(`observing: telemetry=${telemetryDir} audit=${auditDir}`);
    const shutdown = async () => { auditBind?.detach(); await studio.close(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return; // server keeps the loop alive — no exit call
  }

  const objective = positionals.join(' ').trim();
  if (!objective) { console.error('empty objective'); process.exit(2); }
  if (!values.workspace) { console.error('--workspace is required (honest destination, never implicit)'); process.exit(2); }

  const workspaceDir = path.resolve(values.workspace);
  const { config, warnings } = loadConfig(workspaceDir);
  for (const w of warnings) console.error(`config warning: ${w}`);

  const provider = values.profile
    ? (() => {
        try {
          const r = resolveProfile(values.profile, { baseUrl: values['provider-url'] || null, model: values.model || null });
          console.error(`provider: profile ${r.name} → ${r.baseUrl} model=${r.model}` + (r.keyHash ? ` key=${r.keyRef} sha256:${r.keyHash}` : ' (no key needed)'));
          return new OpenAICompatibleProvider({ name: r.name, baseUrl: r.baseUrl, apiKey: r.apiKey, model: r.model, extraHeaders: r.extraHeaders });
        } catch (err) {
          console.error(`majin-v2: ${err.message}`);
          process.exit(2); // misconfiguration is misuse — honest exit 2, zero network traffic
        }
      })()
    : values['provider-url']
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
