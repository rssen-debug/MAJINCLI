/* MAJIN — HYPERSWARM fas 1: parallelism analys + DAG-schemaläggare.
   Fail-first: src/core/swarm.js finns inte än. Direktivets urvalstest:
   (a) tre oberoende arbeten → flera workers, (b) sekventiell kedja → en
   worker, (c) för små arbeten → en worker (overhead äter vinsten). Beslutet
   är deterministic kod — aldrig en LLM-fråga (GENESIS ZERO). */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MAJIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-swarm-'));

const { analyzeSwarm, runSwarm, subagentWorker } = await import('../src/core/swarm.js');
const { createRuntime } = await import('../src/core/runtime.js');
const { setScript } = await import('../src/core/provider/mock.js');

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

test('analysator: tre oberoende arbeten → tre workers, kritiskt spår räknat först', () => {
  const a = analyzeSwarm([
    { id: 'a', deps: [], estMs: 60000 },
    { id: 'b', deps: [], estMs: 60000 },
    { id: 'c', deps: [], estMs: 60000 },
  ], { overheadMs: 1500 });
  assert.equal(a.decision, 'swarm', 'independent arbeten Fortjänar swarm');
  assert.equal(a.workers, 3);
  assert.equal(a.sequentialMs, 180000);
  assert.equal(a.criticalMs, 60000, 'kritiskt spår = 1×60s (alla oberoende)');
  /* deterministisk modell: makespan = ena nodens 60s + spawn-overhead per worker */
  assert.equal(a.parallelMs, 60000 + 3 * 1500, `makespan-modellen ar explicit, aldrig uppskattad i blindo: ${a.parallelMs}`);
  assert.ok(a.parallelMs >= a.criticalMs, 'parallell makespan underst kritiskt spar');
  assert.ok(a.parallelMs <= a.sequentialMs - 100000, `vinsten maste vara massiv: ${a.parallelMs}`);
  assert.equal(typeof a.reason, 'string');
});

test('analysator: ren kedja → en worker (parallelism lösar inget)', () => {
  const a = analyzeSwarm([
    { id: 'a', deps: [], estMs: 60000 },
    { id: 'b', deps: ['a'], estMs: 60000 },
    { id: 'c', deps: ['b'], estMs: 60000 },
  ], { overheadMs: 1500 });
  assert.equal(a.decision, 'single', `kritisk väg = hela arbetet: ${a.reason}`);
  assert.equal(a.workers, 1);
});

test('analysator: små arbeten + overhead → en worker (vinsten äts upp ärligt)', () => {
  const a = analyzeSwarm(
    Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, deps: [], estMs: 200 })),
    { overheadMs: 1500 },
  );
  assert.equal(a.decision, 'single');
  assert.match(a.reason, /overhead|not worth|spawning/i, `skälet ska ärligt nämna overheden: ${a.reason}`);
});

test('analysator: okänd tid skattas försiktigt, aldrig fantiserat', () => {
  const a = analyzeSwarm([
    { id: 'a', deps: [] },
    { id: 'b', deps: ['a'] },
  ], { overheadMs: 1500 });
  assert.equal(a.decision, 'single', 'två steg med okänd tid ska inte spawna i blindo');
  assert.match(a.reason, /unknown|conservative/i, a.reason);
});

test('schemaläggare: tre oberoende noder verkligen överlappar — mätbar väggtid', async () => {
  const startedAt = {}, endedAt = {};
  const mk = (id) => async () => {
    startedAt[id] = performance.now();
    await settle(120);
    endedAt[id] = performance.now();
    return { done: id };
  };
  const t0 = performance.now();
  const r = await runSwarm({
    nodes: [
      { id: 'a', deps: [], run: mk('a') },
      { id: 'b', deps: [], run: mk('b') },
      { id: 'c', deps: [], run: mk('c') },
    ],
    cap: 3,
  });
  const wall = performance.now() - t0;
  assert.equal(r.okCount, 3);
  assert.ok(wall < 120 * 2.2, `parallellt ska brinna typ en nodtid, inte tre: vägg ${wall.toFixed(0)}ms`);
  /* överlapp-bevis: minst två noder höll på samtidigt, annars var det köttfärs i rock */
  const overlaps = ['a', 'b', 'c'].filter((x) => ['a', 'b', 'c'].some((y) => y !== x && startedAt[y] < endedAt[x] && startedAt[x] < endedAt[y]));
  assert.ok(overlaps.length >= 2, 'äkta överlapp krävs (inte bara snabb kö)');
});

test('schemaläggare: beroenden respekteras, aldrig utförda före sina uppdrag', async () => {
  const order = [];
  const mk = (id) => async () => { order.push(id); await settle(10); };
  const r = await runSwarm({
    nodes: [
      { id: 'a', deps: [], run: mk('a') },
      { id: 'b', deps: ['a'], run: mk('b') },
      { id: 'c', deps: ['b'], run: mk('c') },
      { id: 'd', deps: ['a'], run: mk('d') },
    ],
    cap: 4,
  });
  assert.equal(r.okCount, 4);
  assert.ok(order.indexOf('a') < order.indexOf('b'), 'b efter a');
  assert.ok(order.indexOf('b') < order.indexOf('c'), 'c efter b');
  assert.ok(order.indexOf('a') < order.indexOf('d'), 'd efter a');
});

test('schemaläggare: ett misslyckande stoppar inte oberoende grenar', async () => {
  const r = await runSwarm({
    nodes: [
      { id: 'a', deps: [], run: async () => { throw new Error('explody'); } },
      { id: 'b', deps: [], run: async () => ({ value: 'ok-b' }) },
      { id: 'c', deps: ['a'], run: async () => ({ value: 'never' }) },
      { id: 'd', deps: ['b'], run: async () => ({ value: 'ok-d' }) },
    ],
    cap: 2,
  });
  assert.equal(r.okCount, 2, 'b och d ska landa trots att a sprak');
  assert.equal(r.results.get('c').ok, undefined, 'c kördes aldrig — blockad sak är ärligt rapporterad');
  assert.equal(r.results.get('a').ok, false);
  assert.equal(r.results.get('c').blocked, true);
});

test('subagentWorker kör verkliga subagent-turner parallellt (mock-route, inga fablen)', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch({
    models: { provider: 'demo', routes: { tasks: 'demo/demo-fast', chat: 'demo/demo-fast' } },
    guard: { mode: 'off' },
    moa: { policy: 'off' },
  }, { persist: false });
  /* mock nycklar pa `${label}:${job}` — subagent-loopen labelar 'sub'.
     Tre identiska steg for att alla tre workers ska fa samma forsta-svar. */
  setScript('sub:tasks', [1, 2, 3].map(() => ({ text: 'svar från sub-workern' })));
  const worker = subagentWorker({ cfg: rt.cfg, registry: rt.registry, sessionPrefix: 'swarm-test' });
  const t0 = performance.now();
  const r = await runSwarm({
    nodes: [
      { id: 'r1', deps: [], input: 'research topic one', run: worker },
      { id: 'r2', deps: [], input: 'research topic two', run: worker },
      { id: 'r3', deps: [], input: 'research topic three', run: worker },
    ],
    cap: 3,
  });
  const wall = performance.now() - t0;
  assert.equal(r.okCount, 3, JSON.stringify([...r.results.entries()]).slice(0, 300));
  for (const [id, res] of r.results) {
    assert.ok(res.ok, `${id}: ok`);
    assert.match(res.value?.text || '', /svar från sub-workern/, `${id}: äkta sub-svar`);
  }
  assert.ok(wall < 4000, `tre parallella mock-turner ska vara snabba: ${wall.toFixed(0)}ms`);
  await rt.shutdown();
});
