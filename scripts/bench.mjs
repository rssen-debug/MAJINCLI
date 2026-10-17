#!/usr/bin/env node
/**
 * MAJIN — scenario bench.
 *
 * Measures MAJIN's own machinery (routing, tool loop, guard, MOA, memory) against
 * the mock provider: the same scenarios every run, no keys, no network.
 * The answers are scripted — what gets measured is the plumbing, not the model.
 *
 *   node scripts/bench.mjs                 # tabell + verdict
 *   node scripts/bench.mjs --json          # machine-readable
 *   node scripts/bench.mjs --turns=5       # repeat every scenario (percentiles)
 *   node scripts/bench.mjs --scenario=fs   # one scenario
 *   MAJIN_BENCH_KEEP=1 node scripts/bench.mjs   # keep the data home
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name, def = undefined) => {
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  return argv.includes(`--${name}`) ? true : def;
};
const asJson = Boolean(flag('json', false));
const turns = Math.max(1, Number(flag('turns', 1)) || 1);
const only = flag('scenario');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-bench-'));
process.env.MAJIN_HOME = home;
process.env.MAJIN_TOKEN = 'bench';

/* --------------------------------------------------------------------------
   Scenarios. `expect` is what we require after the turn:
     tool      — a tool that must have run (regex on the name)
     avoid     — a tool that must NOT run (regex)
     file      — { path, contains } : a file that must have been written in the workspace
     events    — event types that must be present
     guardAsk  — true: expect an approval request (the off path is not tested here)
     answer    — regex mot slutsvaret
   -------------------------------------------------------------------------- */
const SCENARIOS = [
  {
    name: 'fs.write',
    input: 'write the text "bench ok" to bench.txt',
    job: 'tasks',
    steps: [{ text: 'Writing the file.', toolCalls: [{ name: 'fs.write', args: { path: 'bench.txt', content: 'bench ok\n' } }] }, { text: 'Wrote bench.txt.' }],
    expect: { tool: /^fs\.write$/, file: { path: 'bench.txt', contains: 'bench ok' }, events: ['tool_result', 'answer'] },
  },
  {
    name: 'fs.read+summarize',
    input: 'read notes.md and tell me what is in it',
    job: 'tasks',
    seed: { 'notes.md': 'alpha 1\nbeta 2\ngamma 3\n' },
    steps: [{ text: 'Reading.', toolCalls: [{ name: 'fs.read', args: { path: 'notes.md' } }] }, { text: 'Three lines: alpha, beta, gamma.' }],
    expect: { tool: /^fs\.read$/, answer: /alpha|beta|gamma/i },
  },
  {
    name: 're.analyze',
    input: 'analyse the file suspect.exe',
    job: 're',
    seedBin: { 'suspect.exe': 'pe' },
    steps: [{ text: 'Analysing.', toolCalls: [{ name: 're.analyze', args: { path: 'suspect.exe' } }] }, { text: 'A 32-bit PE with one section.' }],
    expect: { tool: /^re\.analyze$/, events: ['tool_result'] },
  },
  {
    name: 'shell.run',
    input: 'run `node -v` and tell me the version',
    job: 'tools',
    steps: [{ text: 'Running it.', toolCalls: [{ name: 'shell.run', args: { command: 'node -v' } }] }, { text: 'Node reports a version.' }],
    expect: { tool: /^shell\.run$/, avoid: /^shell\.bg$/ },
  },
  {
    name: 'multi-step',
    input: 'create a.md and b.md, then list the folder',
    job: 'tasks',
    steps: [
      { text: 'First file.', toolCalls: [{ name: 'fs.write', args: { path: 'a.md', content: 'a\n' } }] },
      { text: 'Second file.', toolCalls: [{ name: 'fs.write', args: { path: 'b.md', content: 'b\n' } }] },
      { text: 'Listing.', toolCalls: [{ name: 'fs.list', args: { path: '.' } }] },
      { text: 'Created a.md and b.md and listed them.' },
    ],
    expect: { tool: /^fs\.list$/, file: { path: 'a.md' }, events: ['step'] },
  },
  {
    name: 'self-config',
    input: 'run with 4 references',
    job: 'tasks',
    steps: [{ text: 'should not be used' }],
    expect: { config: { path: 'moa.width', value: 4 }, avoid: /.*/ },
  },
  {
    name: 'guard-approval',
    input: 'delete victim.txt permanently',
    job: 'tasks',
    guard: 'strict',
    seed: { 'victim.txt': 'do not delete me\n' },
    steps: [{ text: 'Deleting.', toolCalls: [{ name: 'fs.delete', args: { path: 'victim.txt', permanent: true } }] }, { text: 'Refused, as instructed.' }],
    expect: { guardAsk: true, fileAbsent: 'victim.txt' },
  },
];

const JOBS = ['tasks', 'tools', 're', 'chat', 'code', 'research', 'analysis', 'summarize', 'plan', 'final'];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

async function main() {
  const { createRuntime } = await import('../src/core/runtime.js');
  const { setScript } = await import('../src/core/provider/mock.js');

  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch(
    {
      workspace: path.join(home, 'workspace'),
      models: {
        provider: 'demo',
        routes: Object.fromEntries(JOBS.map((j) => [j, 'demo/demo-fast'])),
      },
      moa: { policy: 'always', width: 2 },
      guard: { mode: 'off' },
      tasks: { approvalTimeoutMs: 1500, concurrency: 3 },
      agent: { maxSteps: 8 },
    },
    { persist: false },
  );
  const WS = rt.cfg.get('workspace');
  fs.mkdirSync(WS, { recursive: true });

  // Count real approval requests by wrapping approvals.request —
  // bus events are not a contract, and the turn's onEvent does not see them.
  let approvalHits = 0;
  const { approvals } = await import('../src/core/guard.js');
  const origRequest = approvals.request.bind(approvals);
  approvals.request = (req, timeoutMs) => { approvalHits += 1; return origRequest(req, timeoutMs); };

  const results = [];
  for (const sc of SCENARIOS) {
    if (only && sc.name !== only && !sc.name.startsWith(only)) continue;
    for (let turn = 0; turn < turns; turn += 1) {
      for (const [name, text] of Object.entries(sc.seed || {})) fs.writeFileSync(path.join(WS, name), text);
      if (sc.seedBin?.['suspect.exe']) {
        const head = Buffer.alloc(0x400, 0);
        head.write('MZ', 0, 'ascii');
        head.writeUInt16LE(0x4, 0x3c);
        head.write('PE\0\0', 4, 'ascii');
        head.writeUInt16LE(0x8664, 8);
        head.writeUInt16LE(1, 10);
        head.writeUInt16LE(112, 24);
        head.writeUInt16LE(0x20b, 28);
        head.write('.text\0\0\0', 0xf8, 'binary');
        head.writeUInt32LE(0x400, 0xf8 + 8);
        head.writeUInt32LE(0x1000, 0xf8 + 12);
        head.writeUInt32LE(0x200, 0xf8 + 16);
        head.writeUInt32LE(0x200, 0xf8 + 20);
        head.write('http://evil.example/x', 0x210, 'ascii');
        fs.writeFileSync(path.join(WS, 'suspect.exe'), head);
      }
      if (sc.expect.config?.path === 'moa.width') rt.cfg.patch({ moa: { width: 3 } }, { persist: false });

      for (const job of JOBS) setScript(`main:${job}`, sc.steps.map((x) => ({ ...x })));
      // MOA: the references and the aggregator are their own calls — script them so the answer is predictable
      const finalText = sc.steps[sc.steps.length - 1]?.text || 'done';
      for (const k of ['moa-ref-0', 'moa-ref-1', 'moa-ref-2', 'final:aggregator', 'final:moa', 'final:escalate']) setScript(k, [{ text: finalText }]);
      if (sc.guard) rt.cfg.patch({ guard: { mode: sc.guard } }, { persist: false });

      const evs = [];
      approvalHits = 0;
      const approvals = [];
      const t0 = process.hrtime.bigint();
      let out = null;
      let err = null;
      try {
        out = await rt.agent.turn({
          input: sc.input,
          session: `bench-${sc.name}-${turn}`,
          onEvent: (e) => {
            evs.push(e);
            if (String(e.type || '').startsWith('approval:')) approvals.push(e);
          },
        });
      } catch (e) {
        err = e;
      }
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      if (sc.guard) rt.cfg.patch({ guard: { mode: 'confirm' } }, { persist: false });

      const toolEvents = evs.filter((e) => e.type === 'tool_result');
      const names = toolEvents.map((e) => e.name || e.tool).filter(Boolean);
      const checks = [];
      const check = (label, ok, detail = '') => checks.push({ label, ok: Boolean(ok), detail: String(detail).slice(0, 160) });

      check('turn completed', !err && !!out, err?.message || '');
      if (sc.expect.guardAsk) check('approval requested', approvalHits > 0, `requests=${approvalHits} turnEvents=${approvals.length} tools=${names.length}`);
      if (sc.expect.tool) check(`tool ${sc.expect.tool}`, names.some((n) => sc.expect.tool.test(n)), names.join(','));
      if (sc.expect.avoid) {
        const bad = names.filter((n) => sc.expect.avoid.test(n));
        check('no forbidden tool', bad.length === 0, bad.join(','));
      }
      if (sc.expect.file) {
        const abs = path.join(WS, sc.expect.file.path);
        const exists = fs.existsSync(abs);
        check(`file ${sc.expect.file.path}`, exists && (!sc.expect.file.contains || fs.readFileSync(abs, 'utf8').includes(sc.expect.file.contains)), exists ? 'content' : 'missing');
      }
      if (sc.expect.fileAbsent) check(`${sc.expect.fileAbsent} still there`, fs.existsSync(path.join(WS, sc.expect.fileAbsent)), 'the refusal must have prevented the delete');
      for (const ev of sc.expect.events || []) check(`event ${ev}`, evs.some((e) => e.type === ev), '');
      if (sc.expect.answer) check('answer matches', sc.expect.answer.test(String(out?.text || '')), String(out?.text || '').slice(0, 80));
      if (sc.expect.config) {
        const got = rt.cfg.get(sc.expect.config.path);
        check(`config ${sc.expect.config.path}=${sc.expect.config.value}`, got === sc.expect.config.value, `got ${got}`);
      }

      results.push({
        scenario: sc.name,
        turn,
        ms: Math.round(ms),
        steps: out?.steps ?? 0,
        tools: names.length,
        toolNames: names,
        events: evs.length,
        ok: checks.every((c) => c.ok),
        checks,
      });
    }
  }

  const per = new Map();
  for (const r of results) {
    const list = per.get(r.scenario) || [];
    list.push(r);
    per.set(r.scenario, list);
  }
  const rows = [...per.entries()].map(([name, list]) => ({
    scenario: name,
    runs: list.length,
    pass: list.filter((x) => x.ok).length,
    msAvg: Math.round(list.reduce((a, b) => a + b.ms, 0) / list.length),
    msP50: percentile(list.map((x) => x.ms), 50),
    msP95: percentile(list.map((x) => x.ms), 95),
    tools: +(list.reduce((a, b) => a + b.tools, 0) / list.length).toFixed(2),
    steps: +(list.reduce((a, b) => a + b.steps, 0) / list.length).toFixed(2),
    events: list[0].events,
  }));
  const usage = rt.usage.summary();
  const verdict = {
    at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    turns,
    scenarios: rows,
    totals: {
      runs: results.length,
      passed: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      msTotal: Math.round(results.reduce((a, b) => a + b.ms, 0)),
      msP50: percentile(results.map((x) => x.ms), 50),
      msP95: percentile(results.map((x) => x.ms), 95),
      requests: usage.requests || 0,
      tokens: usage.tokens || 0,
      costUsd: +(usage.costUsd || 0).toFixed(4),
    },
    ok: results.length > 0 && results.every((r) => r.ok),
  };

  await rt.shutdown();
  if (!process.env.MAJIN_BENCH_KEEP) fs.rmSync(home, { recursive: true, force: true });
  else process.stdout.write(`bench home kept: ${home}\n`);

  if (asJson) {
    process.stdout.write(JSON.stringify(verdict, null, 2) + '\n');
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    process.stdout.write(`\nMAJIN bench — mock provider, ${turns} turn(s) per scenario\n`);
    process.stdout.write(`${pad('scenario', 18)}${pad('pass', 7)}${pad('avg', 8)}${pad('p50', 8)}${pad('p95', 8)}${pad('tools', 7)}${pad('steps', 7)}events\n`);
    process.stdout.write('-'.repeat(72) + '\n');
    for (const r of rows) {
      process.stdout.write(`${pad(r.scenario, 18)}${pad(`${r.pass}/${r.runs}`, 7)}${pad(`${r.msAvg}ms`, 8)}${pad(`${r.msP50}ms`, 8)}${pad(`${r.msP95}ms`, 8)}${pad(r.tools, 7)}${pad(r.steps, 7)}${r.events}\n`);
    }
    const t = verdict.totals;
    process.stdout.write('-'.repeat(72) + '\n');
    process.stdout.write(`${t.passed}/${t.runs} runs green · p50 ${t.msP50}ms · p95 ${t.msP95}ms · ${t.requests} provider calls · ${t.tokens} tokens · $${t.costUsd}\n\n`);
    for (const r of results.filter((x) => !x.ok)) {
      process.stdout.write(`FAIL ${r.scenario}: ${r.checks.filter((c) => !c.ok).map((c) => `${c.label} (${c.detail})`).join('; ')}\n`);
    }
    process.stdout.write(verdict.ok ? 'VERDICT: pass\n' : 'VERDICT: fail\n');
  }
  process.exitCode = verdict.ok ? 0 : 1;
}

main().catch((e) => {
  process.stderr.write(`bench crashed: ${e.stack || e.message}\n`);
  process.exitCode = 2;
});
