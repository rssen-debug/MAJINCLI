/* MAJIN GRAND ARCHITECT — mission compiler: fritt mål → DAG → HYPERSWARM.
   Beslutet ANTAL workers fattas aldrig av modellen (analyzer i kod);
   modellen får bara FYLLA grafen. Fallnar kompilern: vanlig turn. GENESIS ZERO
   överlever ALLTID: mission kan aldrig krascha en tur. */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

process.env.MAJIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-mission-'));

const { shouldMission, compileMission } = await import('../src/core/mission.js');
const { createRuntime } = await import('../src/core/runtime.js');
const { setScript } = await import('../src/core/provider/mock.js');

test('shouldMission: numrerad eller tydligt flerdelad uppgift känns igen — deskriptivt, aldrig godtyckligt', () => {
  const listig = shouldMission('1. Skriv filen a2.txt\n2. Rensa temporbobbelsen\n3. Rapportp överresultat till mig');
  assert.equal(listig.mission, true, 'numrerad lista = verktygsGo');
  assert.match(listig.reason, /3/);
  const komma = shouldMission('rensa Downloads, sortera filerna efter typ, zip de viktigaste, flytta arkivet till backuper');
  assert.equal(komma.mission, true, 'fyra komma-separerade verbit');
  const enkel = shouldMission('vad heter Sveriges huvudstad?');
  assert.equal(enkel.mission, false);
  const kort = shouldMission('hjälp');
  assert.equal(kort.mission, false);
});

test('compileMission: modellen formulerar DAG-en, ANALYZATORN validera: cycles, max-noder, skadade deps', async () => {
  const empty = await compileMission('vad ska jag ata till middag', { cfg: null });
  assert.equal(empty.kind, 'single', 'icke-mission compilerar aldrig');

  const cfg = await (await import('../src/core/config.js')).load();
  cfg.patch({
    models: { routes: { tasks: 'demo/demo-fast' } },
    providers: { demo: { kind: 'mock', apiKey: 'demo' } },
  }, { persist: false });

  /* (a) ren JSON → mission med 3 noder, deps ur parsing */
  const good = JSON.stringify({ nodes: [
    { id: 'n1', input: 'write three facts about mars', deps: [], estMs: 30000 },
    { id: 'n2', input: 'collect venus stats', deps: [], estMs: 30000 },
    { id: 'n3', input: 'summarize both research notes', deps: ['n1', 'n2'], estMs: 30000 },
  ] });
  setScript('mission:compile', [{ text: good }]);
  const ok = await compileMission('1. research mars\n2. research venus\n3. skriv sammanfattning', { cfg });
  assert.equal(ok.kind, 'mission', JSON.stringify(ok).slice(0, 200));
  assert.equal(ok.nodes.length, 3);
  assert.deepEqual(ok.nodes[2].deps, ['n1', 'n2']);

  /* (b) modellbrak PA ett icke-listigt input → single med ärlig orsak, aldrig krasch.
     (pa listigt input triktrar den deterministiska reserven istallet — se nasta test) */
  setScript('mission:compile', [{ text: 'absolutely not json, tycker jag själt' }]);
  const bad = await compileMission('rensa meddelanden, flytta mappen, skriv rapport', { cfg });
  assert.equal(bad.kind, 'single');
  assert.match(bad.reason || '', /json|parse|extract/i);

  /* (c) cyklisk graf avvisarras: beslut i kod */
  setScript('mission:compile', [{ text: JSON.stringify({ nodes: [
    { id: 'a', input: 'x', deps: ['b'], estMs: 1000 },
    { id: 'b', input: 'y', deps: ['a'], estMs: 1000 },
  ] }) }]);
  const cyc = await compileMission('1. äpple\n2. päron\n3. morot', { cfg });
  assert.equal(cyc.kind, 'single');
  assert.match(cyc.reason || '', /cyclic|invalid/i);

  /* (d) för många noder → negr: aldrig överlocked swamord */
  setScript('mission:compile', [{ text: JSON.stringify({ nodes: Array.from({ length: 12 }, (_, i) => ({ id: 'n' + i, input: 'v' + i, deps: [], estMs: 1000 })) }) }]);
  const many = await compileMission('1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g\n8. h\n9. i\n10. j\n11. k\n12. l', { cfg });
  assert.equal(many.kind, 'single');
  assert.match(many.reason || '', /too many|nodes|limit/i);
});

test('compileMission: modell fallerar på JSON → LISt-fallback producerar mission ändå (små lokala modellers styrka)', async () => {
  const cfg = await (await import('../src/core/config.js')).load();
  cfg.patch({ models: { routes: { tasks: 'demo/demo-fast' } }, providers: { demo: { kind: 'mock', apiKey: 'demo' } } }, { persist: false });
  setScript('mission:compile', [{ text: 'jag kan inte ge dig json, men jag kan roera din värld!' }]);
  const r = await compileMission('1. Skriv filen a.txt\n2. Rensa bobbelmappen\n3. Skriv resultatrapport', { cfg });
  assert.equal(r.kind, 'mission', `heuristic-fallback ska rädda: ${JSON.stringify(r)}`);
  assert.equal(r.origin, 'heuristic-fallback');
  assert.equal(r.nodes.length, 3);
  assert.match(r.nodes[0].input, /Skriv filen/);
});

test('agent.turn: en deskriptivt flerdelsuppgift körs som mission MED äkta workers (mock-rout)', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch({
    models: { provider: 'demo', routes: Object.fromEntries(['tasks', 'chat', 'router', 'analysis', 'plan', 'research', 'code', 're', 'final', 'aggregator'].map((j) => [j, 'demo/demo-fast'])) },
    guard: { mode: 'off' },
    moa: { policy: 'off' },
  }, { persist: false });

  const dag = JSON.stringify({ nodes: [
    { id: 'r1', input: 'research mars facts', deps: [], estMs: 30000 },
    { id: 'r2', input: 'research venus facts', deps: [], estMs: 30000 },
    { id: 'r3', input: 'research jupiter facts', deps: [], estMs: 30000 },
  ] });
  setScript('mission:compile', [{ text: dag }]);
  setScript('sub:tasks', [{ text: 'mars-notering' }, { text: 'venus-notering' }, { text: 'jupiter-notering' }]);

  const events = [];
  const t0 = performance.now();
  const r = await rt.agent.turn({
    input: '1. Research Mars\n2. Research Venus\n3. Research Jupiter\nThen tell me it is done.',
    session: 'mission-demo',
    onEvent: (e) => events.push(e),
  });
  const wall = performance.now() - t0;

  assert.ok(r.mission, `svaret ska vara en mission: ${JSON.stringify(Object.keys(r))}`);
  assert.equal(r.mission.nodes, 3);
  assert.equal(r.mission.workers, 3, 'analysatorn: 3 oberoende => 3 workers');
  assert.equal(r.mission.okCount, 3);
  assert.match(r.text || '', /3\/3|klar|done/i, 'sammanfattningen säger ärligt status');
  assert.ok(events.some((e) => e.type === 'mission'), 'mission-event emitteras');
  assert.ok(wall < 8000, `3 mock-turner parallellt: ${wall.toFixed(0)}ms`);
  await rt.shutdown();
});

test('agent.turn: enkelfråga tas ALDRIG den mission-vägen (GENESIS ZERO intakt)', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch({
    models: { provider: 'demo', routes: Object.fromEntries(['tasks', 'chat', 'router', 'analysis', 'plan', 'research', 'code', 're', 'final', 'aggregator'].map((j) => [j, 'demo/demo-fast'])) },
    guard: { mode: 'off' },
    moa: { policy: 'off' },
  }, { persist: false });
  setScript('main:tasks', [{ text: 'Stockholm är huvudstaden.' }]);
  const r = await rt.agent.turn({ input: 'vad är Sveriges huvudstad?', session: 'single-demo' });
  assert.ok(!r.mission, 'enkelsekraften ska INTE bli mission');
  assert.match(r.text || '', /Stockholm/);
  await rt.shutdown();
});
