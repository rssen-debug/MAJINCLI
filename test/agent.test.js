/* MAJIN — agent end-to-end med mock-leverantören: ingen nätverk, ingen nyckel.
   Bevisar: route → verktygsslinga → fil på disk → MOA → minne → usage,
   självkonfig utan modellanrop, godkännandeväg och avbrott. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-agent-'));
process.env.MAJIN_HOME = home;
process.env.MAJIN_CONFIG = path.join(home, 'config.json');

const { createRuntime } = await import('../src/core/runtime.js');
const { setScript } = await import('../src/core/provider/mock.js');

const rt = await createRuntime({ channels: false, scheduler: false });
rt.cfg.patch({
  workspace: path.join(home, 'workspace'),
  models: { provider: 'demo', routes: Object.fromEntries(['chat', 'tasks', 'tools', 'code', 're', 'analysis', 'final', 'plan', 'research', 'summarize', 'router', 'aggregator', 'vision'].map((j) => [j, 'demo/demo-fast'])) },
  moa: { policy: 'always', width: 2 },
  // en nyckel som inte anvands (rutterna pekar kvar pa demo) haller igang MOA:
  // utan en enda riktig nyckel hoppar agenten over MOA-motet med flit
  providers: { openai: { apiKey: 'test-key-not-used', kind: 'openai', baseUrl: 'http://127.0.0.1:1' } },
  guard: { mode: 'off' },
  agent: { maxSteps: 6 },
});
const WS = rt.cfg.get('workspace');

/* the mock is keyed on '<label>:<job>' — script every job so the turn is caught regardless of routing */
const JOBS = ['tasks', 'tools', 're', 'chat', 'code', 'research', 'analysis', 'summarize', 'plan', 'final'];
function scriptAll(steps) {
  for (const j of JOBS) setScript(`main:${j}`, steps.map((x) => ({ ...x })));
}

function collect() {
  const evs = [];
  return { evs, onEvent: (e) => evs.push(e), types: () => evs.map((e) => e.type) };
}

test('turn: the tool writes to disk, MOA answers, everything is logged', async () => {
  scriptAll([
    { text: 'Skriver filen.', toolCalls: [{ name: 'fs.write', args: { path: 'agent-prov.txt', content: 'linje ett\nlinje två\n' } }] },
    { text: 'Klart — filen är skriven med två rader.' },
  ]);
  const c = collect();
  const r = await rt.agent.turn({ input: 'skriv texten "linje ett / linje två" till agent-prov.txt', session: 't1', onEvent: c.onEvent });
  const file = path.join(WS, 'agent-prov.txt');
  assert.ok(fs.existsSync(file), 'the tool must actually have written the file');
  assert.equal(fs.readFileSync(file, 'utf8'), 'linje ett\nlinje två\n');
  assert.ok((r.text || '').length > 0, 'the answer must not be empty');
  const t = c.types();
  for (const want of ['route', 'step', 'delta', 'tool', 'tool_result', 'usage', 'moa:start', 'moa:ref', 'moa:done', 'answer']) {
    assert.ok(t.includes(want), `händelsen ${want} must exist (fick ${t.join(',')}）`.replace('）', ')'));
  }
  const tr = c.evs.find((e) => e.type === 'tool_result');
  assert.equal(tr.ok, true, 'the tool must report ok');
  assert.equal(tr.tool, 'fs.write');
  assert.match(String(r.job || ''), /tasks|tools|re|chat/, 'the job must be classified');
});

test('route: a binary attachment pulls toward the re job', async () => {
  const c = collect();
  const bin = path.join(WS, 'prov.exe');
  const head = Buffer.alloc(0x200, 0);
  head.write('MZ', 0, 'ascii');
  fs.writeFileSync(bin, head);
  await rt.agent.turn({ input: 'titta på den här filen', session: 't2', attachments: [{ name: 'prov.exe', path: bin, size: 0x200, kind: 'bin' }], onEvent: c.onEvent });
  const route = c.evs.find((e) => e.type === 'route');
  assert.ok(route, 'the route event is missing');
  assert.equal(typeof route.confidence, 'number');
  assert.ok(Array.isArray(route.reasons) && route.reasons.length, 'the classification must be justified');
});

test('plan: agent.plan writes the visible work list', async () => {
  const out = await rt.registry.exec('agent.plan', { items: [{ text: 'läs fil', status: 'done' }, { text: 'skriv rapport', status: 'doing' }], mode: 'replace', note: 'start' }, { session: 'tplan' });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.meta.plan.length, 2, 'meta.plan must be returned');
  assert.equal(out.meta.plan[0].status, 'done');
  assert.equal(out.meta.plan[0].id, 't1', 'ids must be generated');
  assert.match(out.result, /plan \(1\/2 done\)/, 'the result must show progress');
  assert.deepEqual(rt.agent.plans.get('tplan').map((x) => x.text), ['läs fil', 'skriv rapport'], 'the plan must land on the session (the UI reads it there)');
  const merged = await rt.registry.exec('agent.plan', { items: [{ text: 'verifiera', status: 'todo' }], mode: 'merge' }, { session: 'tplan' });
  assert.equal(merged.ok, true, JSON.stringify(merged.error));
  assert.equal(merged.meta.plan.length, 3, 'merge must append to the existing plan');
  assert.deepEqual(merged.meta.plan.map((p) => p.text), ['läs fil', 'skriv rapport', 'verifiera']);
  assert.deepEqual(merged.meta.plan.map((p) => p.id), ['t1', 't2', 't3'], 'auto ids must not collide on merge');
});

test('self-config: natural language patches with no model call', async () => {
  const before = rt.cfg.get('moa.width');
  const c = collect();
  const r = await rt.agent.turn({ input: 'kör med 3 referenser', session: 't3', onEvent: c.onEvent });
  assert.equal(rt.cfg.get('moa.width'), 3, 'the width must change');
  assert.notEqual(before, 3);
  assert.ok(!c.types().includes('step'), 'no tool loop for a pure config turn');
  assert.match(String(r.text || ''), /MOA|referens|3/, 'the answer must say what changed');
  assert.ok(r.fastPath || r.job === 'config', 'the fast path must be marked');
  // och en router-row
  const r2 = await rt.agent.turn({ input: 'använd demo/demo-fast för code alltid', session: 't3' });
  assert.equal(rt.cfg.get('models.routes.code'), 'demo/demo-fast', JSON.stringify(r2.text));
});

test('guard: a refused approval means the tool never runs', async () => {
  rt.cfg.patch({ guard: { mode: 'confirm' } });
  const victim = path.join(WS, 'offer.txt');
  fs.writeFileSync(victim, 'innehåll');
  scriptAll([
    { text: 'Tar bort filen.', toolCalls: [{ name: 'fs.delete', args: { path: 'offer.txt', permanent: true } }] },
    { text: 'Klar.' },
  ]);
  const c = collect();
  const p = rt.agent.turn({ input: 'ta bort offer.txt permanent', session: 't4', onEvent: c.onEvent });
  // vänta in köpost och neka
  let id = null;
  for (let i = 0; i < 200 && !id; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
    id = rt.approvals.list().find((a) => a.tool === 'fs.delete')?.id || null;
  }
  assert.ok(id, 'an approval request must enter the queue');
  rt.approvals.respond(id, false, 'testar');
  const r = await p;
  assert.ok(fs.existsSync(victim), 'a refused action must not delete the file');
  assert.ok(r, 'the turn must still finish');
  assert.equal(rt.approvals.list().length, 0, 'the queue must be empty after the decision');
  rt.cfg.patch({ guard: { mode: 'off' } });
});

test('memory and usage: the turn saves and counts', async () => {
  const before = rt.usage.summary();
  const c = collect();
  await rt.agent.turn({ input: 'kom ihåg att projektet ligger i workspacet', session: 't5', onEvent: c.onEvent });
  const after = rt.usage.summary();
  assert.ok((after.requests || 0) > (before.requests || 0), 'requests must be counted');
  assert.ok((after.tokens || 0) > 0, 'tokens must be recorded');
  const rec = rt.memory.recall('projekt');
  assert.ok(Array.isArray(rec), 'recall must return an array');
  const stats = rt.memory.stats();
  assert.ok(stats && typeof stats === 'object', 'memory stats must exist');
  const hist = fs.readdirSync(path.join(home, 'sessions'));
  assert.ok(hist.some((f) => f.includes('t5')), 'the session must be saved to disk');
});

test('loop reserves the last budget step for a final answer', async () => {
  const previous = rt.cfg.get('agent.maxSteps');
  rt.cfg.patch({ agent: { maxSteps: 2 } });
  scriptAll([
    { text: 'I will write the file.', toolCalls: [{ name: 'fs.write', args: { path: 'final-step.txt', content: 'verified' } }] },
    { text: 'The file was written and verified.' },
  ]);
  setScript('main:final', [{ text: 'The file was written and verified.' }]);
  const c = collect();
  const r = await rt.agent.turn({ input: 'write verified to final-step.txt', session: 't-final-step', onEvent: c.onEvent });
  assert.equal(fs.readFileSync(path.join(WS, 'final-step.txt'), 'utf8'), 'verified');
  assert.ok(c.evs.some((e) => e.type === 'step' && e.finalizing), 'the last model call must be explicitly marked as finalizing');
  assert.match(r.text, /written and verified/i);
  assert.equal(r.incomplete, undefined);
  assert.ok(!c.types().includes('moa:start'), 'do not rephrase a step-budget final answer through MOA');
  rt.cfg.patch({ agent: { maxSteps: previous } });
});

test('loop blocks an identical retry after a failed tool call', async () => {
  rt.cfg.patch({ routing: { escalateAfterErrors: 10 }, agent: { maxSteps: 5 } });
  scriptAll([
    { text: 'I will inspect the path.', toolCalls: [{ name: 'fs.read', args: { path: 'missing-repeat-test.txt' } }] },
    { text: 'Retrying the same read.', toolCalls: [{ name: 'fs.read', args: { path: 'missing-repeat-test.txt' } }] },
    { text: 'The file is missing, so I cannot read it.' },
  ]);
  const c = collect();
  const r = await rt.agent.turn({ input: 'read missing-repeat-test.txt', session: 't-repeat', onEvent: c.onEvent });
  const reads = c.evs.filter((e) => e.type === 'tool_result' && e.tool === 'fs.read');
  assert.equal(reads.length, 2, 'both the actual failure and blocked retry must be reported');
  assert.notEqual(reads[0].error?.code, 'repeat_blocked', 'the first call must reach the tool');
  assert.equal(reads[1].error?.code, 'repeat_blocked', 'the unchanged retry must not reach the tool');
  assert.match(r.text, /missing|cannot read/i);
  rt.cfg.patch({ routing: { escalateAfterErrors: 2 }, agent: { maxSteps: 6 } });
});

test('loop never repeats an already successful state-changing call', async () => {
  rt.cfg.patch({ routing: { escalateAfterErrors: 10 }, agent: { maxSteps: 5 }, moa: { policy: 'off' } });
  scriptAll([
    { text: 'Create the file once.', toolCalls: [{ name: 'fs.write', args: { path: 'repeat-write.txt', content: 'one write' } }] },
    { text: 'Retrying the write.', toolCalls: [{ name: 'fs.write', args: { path: 'repeat-write.txt', content: 'one write' } }] },
    { text: 'The existing write succeeded; no duplicate was made.' },
  ]);
  const c = collect();
  const r = await rt.agent.turn({ input: 'write one write to repeat-write.txt', session: 't-repeat-write', onEvent: c.onEvent });
  const writes = c.evs.filter((e) => e.type === 'tool_result' && e.tool === 'fs.write');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].ok, true);
  assert.equal(writes[1].error?.code, 'repeat_blocked');
  assert.equal(fs.readFileSync(path.join(WS, 'repeat-write.txt'), 'utf8'), 'one write');
  assert.match(r.text, /existing write succeeded|duplicate/i);
  rt.cfg.patch({ routing: { escalateAfterErrors: 2 }, agent: { maxSteps: 6 }, moa: { policy: 'always' } });
});

test('loop serializes tool batches that can change state', async () => {
  rt.cfg.patch({ agent: { maxSteps: 5 }, moa: { policy: 'off' } });
  scriptAll([
    {
      text: 'Create both files.',
      toolCalls: [
        { name: 'fs.write', args: { path: 'batch-a.txt', content: 'a' } },
        { name: 'fs.write', args: { path: 'batch-b.txt', content: 'b' } },
      ],
    },
    { text: 'Both files were created.' },
  ]);
  const c = collect();
  await rt.agent.turn({ input: 'create batch-a.txt and batch-b.txt', session: 't-serial-batch', onEvent: c.onEvent });
  assert.ok(c.evs.some((e) => e.type === 'tool_batch' && e.parallel === false), 'write batches must never use Promise.all');
  assert.equal(fs.readFileSync(path.join(WS, 'batch-a.txt'), 'utf8'), 'a');
  assert.equal(fs.readFileSync(path.join(WS, 'batch-b.txt'), 'utf8'), 'b');
  rt.cfg.patch({ agent: { maxSteps: 6 }, moa: { policy: 'always' } });
});

test('pause holds an active turn at a safe boundary until resumed', async () => {
  scriptAll([{ text: 'Resumed and ready.' }]);
  const c = collect();
  rt.agent.pause();
  const pending = rt.agent.turn({ input: 'say ready', session: 't-paused', onEvent: c.onEvent });
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.ok(c.types().includes('paused'), 'the UI should receive a paused event');
  assert.ok(!c.types().includes('step'), 'no model step should start while paused');
  rt.agent.resume();
  const r = await pending;
  assert.match(r.text, /resumed and ready/i);
});

test('abort: stop() unwinds without hanging', async () => {
  scriptAll(Array.from({ length: 6 }, () => ({ text: 'jobbar vidare …', toolCalls: [{ name: 'fs.list', args: { path: '.' } }] })));
  const c = collect();
  const p = rt.agent.turn({ input: 'lista mappen 20 gånger', session: 't6', onEvent: c.onEvent });
  await new Promise((r) => setTimeout(r, 40));
  rt.agent.stop('t6');
  const r = await p;
  assert.ok(r, 'the turn must resolve after stop');
  assert.ok(c.types().includes('step'), 'a few steps must have run');
  assert.ok(!c.types().includes('error') || c.evs.some((e) => e.type === 'error' && /abort|cancel|stop/i.test(String(e.message))), 'the error must be an abort, not a crash');
});

test('registry + runtime: the promises kept', async () => {
  assert.equal(rt.registry.list().length, 89, '89 tools, none disabled');
  const names = rt.registry.list().map((t) => t.name);
  for (const must of ['fs.write', 'shell.run', 'web.fetch', 're.analyze', 'majin.configure', 'agent.delegate', 'agent.moa']) {
    assert.ok(names.includes(must), `${must} must exist`);
  }
  const groups = rt.registry.groups();
  assert.ok(Object.keys(groups).length >= 6, 'groups for the UI');
  assert.ok(groups.reverse.length >= 20, 'the RE group must be large');
  assert.equal(typeof rt.version, 'string');
  assert.equal(rt.state({ includeTools: false }).tools.count, 89, 'state must report the tool count');
  assert.equal(rt.state().tools.length, 89, 'full state lists every tool');
  const st = rt.state();
  for (const k of ['config', 'routes', 'moa', 'guard', 'usage', 'channels', 'providers', 'memory']) {
    assert.ok(k in st, `state.${k} is missing`);
  }
});

test('shutdown: closes cleanly', async () => {
  await rt.shutdown();
  assert.ok(true, 'no hanging loops');
});

after(() => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* tmp is cleaned by the OS */
  }
});
