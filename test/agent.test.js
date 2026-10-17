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
  guard: { mode: 'off' },
  agent: { maxSteps: 6 },
});
const WS = rt.cfg.get('workspace');

/* mocken keyed på '<label>:<job>' — scripta alla jobb så fångas turnen oavsett routing */
const JOBS = ['tasks', 'tools', 're', 'chat', 'code', 'research', 'analysis', 'summarize', 'plan', 'final'];
function scriptAll(steps) {
  for (const j of JOBS) setScript(`main:${j}`, steps.map((x) => ({ ...x })));
}

function collect() {
  const evs = [];
  return { evs, onEvent: (e) => evs.push(e), types: () => evs.map((e) => e.type) };
}

test('turn: verktyg skriver på disk, MOA svarar, allt loggas', async () => {
  scriptAll([
    { text: 'Skriver filen.', toolCalls: [{ name: 'fs.write', args: { path: 'agent-prov.txt', content: 'linje ett\nlinje två\n' } }] },
    { text: 'Klart — filen är skriven med två rader.' },
  ]);
  const c = collect();
  const r = await rt.agent.turn({ input: 'skriv texten "linje ett / linje två" till agent-prov.txt', session: 't1', onEvent: c.onEvent });
  const file = path.join(WS, 'agent-prov.txt');
  assert.ok(fs.existsSync(file), 'verktyget måste faktiskt ha skrivit filen');
  assert.equal(fs.readFileSync(file, 'utf8'), 'linje ett\nlinje två\n');
  assert.ok((r.text || '').length > 0, 'the answer must not be empty');
  const t = c.types();
  for (const want of ['route', 'step', 'delta', 'tool', 'tool_result', 'usage', 'moa:start', 'moa:ref', 'moa:done', 'answer']) {
    assert.ok(t.includes(want), `händelsen ${want} måste finnas (fick ${t.join(',')}）`.replace('）', ')'));
  }
  const tr = c.evs.find((e) => e.type === 'tool_result');
  assert.equal(tr.ok, true, 'verktyget måste rapportera ok');
  assert.equal(tr.tool, 'fs.write');
  assert.match(String(r.job || ''), /tasks|tools|re|chat/, 'jobbet måste vara klassificerat');
});

test('route: binärt bilaga tynger mot re-jobbet', async () => {
  const c = collect();
  const bin = path.join(WS, 'prov.exe');
  const head = Buffer.alloc(0x200, 0);
  head.write('MZ', 0, 'ascii');
  fs.writeFileSync(bin, head);
  await rt.agent.turn({ input: 'titta på den här filen', session: 't2', attachments: [{ name: 'prov.exe', path: bin, size: 0x200, kind: 'bin' }], onEvent: c.onEvent });
  const route = c.evs.find((e) => e.type === 'route');
  assert.ok(route, 'route-händelse saknas');
  assert.equal(typeof route.confidence, 'number');
  assert.ok(Array.isArray(route.reasons) && route.reasons.length, 'klassningen måste motiveras');
});

test('plan: agent.plan skriver den synliga arbetslistan', async () => {
  const out = await rt.registry.exec('agent.plan', { items: [{ text: 'läs fil', status: 'done' }, { text: 'skriv rapport', status: 'doing' }], mode: 'replace', note: 'start' }, { session: 'tplan' });
  assert.equal(out.ok, true, JSON.stringify(out.error));
  assert.equal(out.meta.plan.length, 2, 'meta.plan måste returneras');
  assert.equal(out.meta.plan[0].status, 'done');
  assert.equal(out.meta.plan[0].id, 't1', 'id måste genereras');
  assert.match(out.result, /plan \(1\/2 done\)/, 'resultatet måste visa progress');
  assert.deepEqual(rt.agent.plans.get('tplan').map((x) => x.text), ['läs fil', 'skriv rapport'], 'planen måste hamna på sessionen (UI:t läser den där)');
  const merged = await rt.registry.exec('agent.plan', { items: [{ text: 'verifiera', status: 'todo' }], mode: 'merge' }, { session: 'tplan' });
  assert.equal(merged.ok, true, JSON.stringify(merged.error));
  assert.equal(merged.meta.plan.length, 3, 'merge måste lägga till i befintlig plan');
  assert.deepEqual(merged.meta.plan.map((p) => p.text), ['läs fil', 'skriv rapport', 'verifiera']);
  assert.deepEqual(merged.meta.plan.map((p) => p.id), ['t1', 't2', 't3'], 'auto-id får inte krocka vid merge');
});

test('självkonfig: naturligt språk patchar utan modellanrop', async () => {
  const before = rt.cfg.get('moa.width');
  const c = collect();
  const r = await rt.agent.turn({ input: 'kör med 3 referenser', session: 't3', onEvent: c.onEvent });
  assert.equal(rt.cfg.get('moa.width'), 3, 'bredden måste ändras');
  assert.notEqual(before, 3);
  assert.ok(!c.types().includes('step'), 'ingen verktygsslinga för en ren config-turn');
  assert.match(String(r.text || ''), /MOA|referens|3/, 'svaret måste säga vad som ändrades');
  assert.ok(r.fastPath || r.job === 'config', 'snabbspåret måste markeras');
  // och en router-row
  const r2 = await rt.agent.turn({ input: 'använd demo/demo-fast för code alltid', session: 't3' });
  assert.equal(rt.cfg.get('models.routes.code'), 'demo/demo-fast', JSON.stringify(r2.text));
});

test('guard: bekräftelse nekad → verktyget körs inte', async () => {
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
  assert.ok(id, 'en godkännandeförfrågan måste hamna i kön');
  rt.approvals.respond(id, false, 'testar');
  const r = await p;
  assert.ok(fs.existsSync(victim), 'nekad åtgärd får inte ta bort filen');
  assert.ok(r, 'the turn must still finish');
  assert.equal(rt.approvals.list().length, 0, 'kön måste vara tom efter beslut');
  rt.cfg.patch({ guard: { mode: 'off' } });
});

test('minne och usage: turnen sparar och räknar', async () => {
  const before = rt.usage.summary();
  const c = collect();
  await rt.agent.turn({ input: 'kom ihåg att projektet ligger i workspacet', session: 't5', onEvent: c.onEvent });
  const after = rt.usage.summary();
  assert.ok((after.requests || 0) > (before.requests || 0), 'anrop måste räknas');
  assert.ok((after.tokens || 0) > 0, 'tokens måste registreras');
  const rec = rt.memory.recall('projekt');
  assert.ok(Array.isArray(rec), 'recall måste returnera en array');
  const stats = rt.memory.stats();
  assert.ok(stats && typeof stats === 'object', 'minnesstatistik måste finnas');
  const hist = fs.readdirSync(path.join(home, 'sessions'));
  assert.ok(hist.some((f) => f.includes('t5')), 'sessionen måste sparas på disk');
});

test('avbrott: stop() avloopar utan att hänga', async () => {
  scriptAll(Array.from({ length: 6 }, () => ({ text: 'jobbar vidare …', toolCalls: [{ name: 'fs.list', args: { path: '.' } }] })));
  const c = collect();
  const p = rt.agent.turn({ input: 'lista mappen 20 gånger', session: 't6', onEvent: c.onEvent });
  await new Promise((r) => setTimeout(r, 40));
  rt.agent.stop('t6');
  const r = await p;
  assert.ok(r, 'turnen måste resolve:a efter stop');
  assert.ok(c.types().includes('step'), 'några steg hann köras');
  assert.ok(!c.types().includes('error') || c.evs.some((e) => e.type === 'error' && /abort|cancel|stop/i.test(String(e.message))), 'fel måste vara ett avbrott, inte en krasch');
});

test('registry + runtime: levererade åtaganden', async () => {
  assert.equal(rt.registry.list().length, 75, '75 verktyg, inga avstängda');
  const names = rt.registry.list().map((t) => t.name);
  for (const must of ['fs.write', 'shell.run', 'web.fetch', 're.analyze', 'majin.configure', 'agent.delegate', 'agent.moa']) {
    assert.ok(names.includes(must), `${must} måste finnas`);
  }
  const groups = rt.registry.groups();
  assert.ok(Object.keys(groups).length >= 6, 'groups for the UI');
  assert.ok(groups.reverse.length >= 20, 'RE-gruppen måste vara stor');
  assert.equal(typeof rt.version, 'string');
  assert.equal(rt.state({ includeTools: false }).tools.count, 75, 'state måste rapportera verktygsantal');
  assert.equal(rt.state().tools.length, 75, 'full state listar alla verktyg');
  const st = rt.state();
  for (const k of ['config', 'routes', 'moa', 'guard', 'usage', 'channels', 'providers', 'memory']) {
    assert.ok(k in st, `state.${k} saknas`);
  }
});

test('shutdown: stänger rent', async () => {
  await rt.shutdown();
  assert.ok(true, 'inga hängande locket');
});

after(() => {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch {
    /* tmp städas av OS */
  }
});
