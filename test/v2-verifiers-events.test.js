/**
 * V2 verifiers + event bus + verify-bridge contracts.
 * Hardware-free: file/http/pixel verifiable deterministically here; dom asserts
 * the honest degradation class instead of launching a browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { PNG } from 'pngjs';
import { verifyFile, verifyHttp, verifyPixel, verifyDom, verifierRegistry } from '../src/v2/runtime/verifiers.js';
import { verifyAcceptance } from '../src/v2/runtime/verify-bridge.js';
import { EventBus, EVENT_NAMES } from '../src/v2/runtime/events.js';
import { Goal } from '../src/v2/runtime/goal.js';

const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'v2-ver-'));

test('verifier registry exposes all four kinds', () => {
  assert.deepEqual(Object.keys(verifierRegistry).sort(), ['dom', 'file', 'http', 'pixel']);
});

test('file verifier: existence + content evidence, honest failure paths', () => {
  const dir = tmpdir();
  const f = path.join(dir, 'qa.txt');
  fs.writeFileSync(f, 'MAJIN W check');
  const ok = verifyFile({ path: f, minBytes: 5, contains: 'MAJIN' });
  assert.equal(ok.verified, true);
  assert.equal(ok.evidence.kind, 'file');
  assert.equal(ok.evidence.bytes, 13);
  assert.equal(verifyFile({ path: f, contains: 'ABCD' }).verified, false);
  const missing = verifyFile({ path: path.join(dir, 'nope.txt') });
  assert.equal(missing.verified, false);
  assert.equal(missing.error.cls, 'DEPENDENCY_MISSING');
});

test('http verifier: real server, status evidence; connection refused classed', async () => {
  const srv = http.createServer((req, res) => { res.writeHead(req.url === '/ok' ? 200 : 404); res.end('hi'); });
  await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  try {
    const ok = await verifyHttp({ url: `http://127.0.0.1:${port}/ok` });
    assert.equal(ok.verified, true);
    assert.equal(ok.evidence.status, 200);
    assert.equal((await verifyHttp({ url: `http://127.0.0.1:${port}/gone` })).verified, false);
    const refused = await verifyHttp({ url: 'http://127.0.0.1:59999/x' });
    assert.equal(refused.verified, false);
    assert.ok(['NETWORK_FAILURE', 'TIMEOUT'].includes(refused.error.cls));
  } finally { srv.close(); }
});

function writePinkPng(file, { w = 6, h = 4, pinkAt = 12 } = {}) {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < png.data.length; i += 4) { png.data[i] = 10; png.data[i + 1] = 10; png.data[i + 2] = 10; png.data[i + 3] = 255; }
  for (let k = 0; k < pinkAt; k += 1) {
    const i = k * 4;
    png.data[i] = 255; png.data[i + 1] = 0; png.data[i + 2] = 128; png.data[i + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

test('pixel verifier: W12-style region proof — pink counted, wrong color rejected', () => {
  const dir = tmpdir();
  const p = path.join(dir, 'shot.png');
  writePinkPng(p);
  const ok = verifyPixel({ pngPath: p, rgba: [255, 0, 128], minHits: 10 });
  assert.equal(ok.verified, true);
  assert.ok(ok.evidence.hits >= 10);
  const no = verifyPixel({ pngPath: p, rgba: [0, 255, 0], minHits: 5 });
  assert.equal(no.verified, false);
  assert.match(no.error.message, /matching pixels/);
});

test('http verifier: proves body content and stays read-only', async () => {
  const srv = http.createServer((_req, res) => { res.writeHead(200); res.end('receipt: READY'); });
  await new Promise(r => srv.listen(0, r));
  try {
    const url = `http://127.0.0.1:${srv.address().port}/receipt`;
    const ok = await verifyHttp({ url, status: 200, contains: 'READY' });
    assert.equal(ok.verified, true);
    assert.equal(ok.evidence.contains, 'READY');
    assert.match(ok.evidence.sha256, /^[a-f0-9]{64}$/);
    const missing = await verifyHttp({ url, status: 200, contains: 'MISSING' });
    assert.equal(missing.verified, false);
    const mutation = await verifyHttp({ url, method: 'POST' });
    assert.equal(mutation.verified, false);
    assert.match(mutation.error.message, /read-only/);
    const credentials = await verifyHttp({ url: url.replace('://', '://user:secret@') });
    assert.equal(credentials.verified, false);
    assert.match(credentials.error.message, /credentials/);
  } finally { srv.close(); }
});

test('dom verifier: no playwright -> honest DEPENDENCY_MISSING, never a fabricated pass', async () => {
  const out = await verifyDom({ url: 'http://127.0.0.1:1/x', selector: '#a' });
  assert.equal(out.verified, false);
  assert.ok(['DEPENDENCY_MISSING', 'UNKNOWN'].includes(out.error.cls));
});

test('verify-bridge: verifier flips receipt to verified; failure is receipted too', async () => {
  const goal = new Goal({ objective: 'proof', acceptance: [{ id: 'exists', description: 'file exists' }] });
  goal.transition('PLANNING'); goal.transition('READY'); goal.transition('RUNNING');
  const f = path.join(tmpdir(), 'proof.txt');
  const bad = await verifyAcceptance(goal, { acceptanceId: 'exists', kind: 'file', spec: { path: f } });
  assert.equal(bad.verified, false);
  assert.equal(goal.receipts.length, 1);
  assert.equal(goal.receipts[0].result, 'failure');
  fs.writeFileSync(f, 'evidence');
  const good = await verifyAcceptance(goal, { acceptanceId: 'exists', kind: 'file', spec: { path: f } });
  assert.equal(good.verified, true);
  assert.equal(good.receipt.verified, true);
  assert.equal(goal.uncoveredAcceptance().length, 0);
});

test('event bus: ordered delivery, replayable audit, bounded ring', () => {
  const bus = new EventBus({ auditCapacity: 5 });
  const seen = [];
  bus.on('task.completed', (e) => seen.push(e.taskId));
  bus.emit('task.completed', { taskId: 'a' });
  bus.emit('task.completed', { taskId: 'b' });
  assert.deepEqual(seen, ['a', 'b']);
  for (let i = 0; i < 8; i += 1) bus.emit('goal.receipt', { n: i });
  assert.equal(bus.audit().length, 5, 'ring capped at capacity');
  assert.equal(bus.audit({ type: 'goal.receipt' }).length, 5);
  assert.ok(EVENT_NAMES.includes('artifact.created'));
});

test('event bus: a throwing listener is isolated and audited, kernel keeps working', () => {
  const bus = new EventBus();
  bus.on('task.completed', () => { throw new Error('broken listener'); });
  let reached = false;
  bus.on('task.completed', () => { reached = true; });
  bus.emit('task.completed', { taskId: 'x' });
  assert.equal(reached, true);
  assert.equal(bus.audit({ type: 'bus.listener_error' }).length, 1);
  bus.emit('goal.created', { goalId: 'g' });
  assert.equal(bus.audit({ type: 'goal.created' }).length, 1);
});
