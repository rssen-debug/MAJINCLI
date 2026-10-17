/**
 * Onboarding för en vanlig människa. Mätt, inte gissat: första meddelandet på en
 * helt tom installation, de fyra vanliga felen (fel nyckel, slut på krediter,
 * nätverk borta, okänt modellnamn), och provider-väljaren — via samma HTTP som
 * webbläsaren använder.
 */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-onb-'));
process.env.MAJIN_HOME = home;
process.env.MAJIN_CONFIG = path.join(home, 'config.json');
const ROOT = path.resolve(import.meta.dirname, '..');

const { createRuntime } = await import('../src/core/runtime.js');
const { explainError } = await import('../src/core/provider/chat.js');
const JOBS = ['chat', 'tasks', 'tools', 'code', 're', 'analysis', 'plan', 'research', 'final', 'summarize', 'router', 'aggregator', 'vision'];

/* ---------- stand-in provider: räknar varje träff, nyckeln styr felet ---------- */
let hits = 0;
const probe = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    hits += 1;
    const auth = String(req.headers.authorization || '');
    const send = (code, obj) => {
      const b = JSON.stringify(obj);
      res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) });
      res.end(b);
    };
    if (req.url.endsWith('/models')) return send(200, { data: [{ id: 'probe/small', name: 'Probe' }] });
    let body = {};
    try { body = JSON.parse(raw || '{}'); } catch { /* */ }
    if (auth.includes('broke')) return send(402, { error: { message: 'Insufficient balance — add credits to continue', code: 402 } });
    if (!auth.includes('good')) return send(401, { error: { message: 'invalid or missing API key', code: 401 } });
    if (String(body.model || '') === 'gone') return send(400, { error: { message: 'unknown model gone', code: 400 } });
    if (/OVERFLOW/.test(raw)) return send(400, { error: { message: "This request exceeds the model's context window of 200000 tokens", code: 400 } });
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: 'Done.' }, finish_reason: 'stop' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    return send(200, { choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } });
  });
});
await new Promise((r) => probe.listen(0, '127.0.0.1', r));
const PROBE = `http://127.0.0.1:${probe.address().port}`;

/* ---------------- 0) helt första svaret på en tom installation ---------------- */
test('first run: one plain answer, no internal scaffolding, and it says where the key goes', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  const evs = [];
  const t0 = Date.now();
  const r = await rt.agent.turn({ input: 'hej! vad kan du göra?', session: 'first', onEvent: (e) => evs.push(e.type) });
  const ms = Date.now() - t0;
  assert.ok(r.text && r.text.length > 10, 'the first message must get an answer');
  assert.doesNotMatch(r.text, /EVIDENCE FROM THIS TURN/, 'MOA scaffolding must never be what a beginner reads');
  assert.doesNotMatch(r.text, /ANSWERS FROM \d+ REFERENCES/, r.text);
  assert.doesNotMatch(r.text, /Demo answer \(mock\):|QUESTION:/, r.text);
  assert.match(r.text, /Providers/, 'and it must name the one place that fixes it');
  assert.ok(!evs.some((t) => String(t).startsWith('moa:')), `no MOA debate against a demo brain (events: ${evs.join(',')})`);
  assert.ok(ms < 15000, `the first answer must be quick, took ${ms}ms`);
  assert.equal(rt.state().needsSetup, true, 'still flagged as needing setup');
});

/* ---------------- 1) felet en nybörjare får, i mänsklig form ---------------- */
async function turnWith(apiKey, { session = 's', moa = 'always', baseUrl = PROBE, model = 'probe/small' } = {}) {
  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch({
    workspace: path.join(home, 'workspace'),
    guard: { mode: 'off' },
    moa: { policy: moa },
    agent: { maxSteps: 6 },
    providers: { deepseek: { label: 'DeepSeek', kind: 'openai', baseUrl, apiKey, models: [model] } },
    models: { provider: 'deepseek', routes: Object.fromEntries(JOBS.map((j) => [j, `deepseek/${model}`])) },
  });
  const t0 = Date.now();
  const r = await rt.agent.turn({ input: 'hej', session });
  return { rt, r, ms: Date.now() - t0 };
}

test('a rejected key stops at once and says what to do — no retry storm, no jargon', async () => {
  hits = 0;
  const { r, ms } = await turnWith('bad-key', { session: 'auth' });
  assert.match(r.text, /api key/i, `not a human sentence: ${r.text}`);
  assert.match(r.text, /Providers/i, 'it must point at the one place that fixes it');
  assert.doesNotMatch(r.text, /Provider error after \d+ failures/, 'internal retry bookkeeping must not reach the user');
  assert.doesNotMatch(r.text, /fetch failed|TypeError|ECONN/, r.text);
  assert.equal(r.errorKind, 'auth');
  assert.equal(hits, 1, `a permanent auth error must be attempted once, got ${hits} provider calls`);
  assert.equal(r.steps, 1, `the turn must not burn four steps, got ${r.steps}`);
  assert.ok(ms < 5000, `and it must fail fast, took ${ms}ms`);
});

test('out of credit says credit and offers another provider', async () => {
  hits = 0;
  const { r } = await turnWith('broke-key', { session: 'bill' });
  assert.match(r.text, /credit|balance/i, r.text);
  assert.match(r.text, /provider/i, 'a beginner needs the way out, not just the problem');
  assert.equal(r.errorKind, 'billing');
  assert.equal(hits, 1, `402 must not be retried either, got ${hits}`);
});

test('an unknown model name is named, not swallowed', async () => {
  hits = 0;
  const { r } = await turnWith('good-key', { session: 'model', model: 'gone' });
  assert.match(r.text, /model/i, r.text);
  assert.equal(r.errorKind, 'model');
});

test('a too-long conversation says "shorten this", not the raw 400', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  rt.cfg.patch({
    workspace: path.join(home, 'workspace'),
    guard: { mode: 'off' },
    moa: { policy: 'off' },
    providers: { deepseek: { label: 'DeepSeek', kind: 'openai', baseUrl: PROBE, apiKey: 'good-key', models: ['probe/small'] } },
    models: { provider: 'deepseek', routes: Object.fromEntries(JOBS.map((j) => [j, 'deepseek/probe/small'])) },
  });
  const r = await rt.agent.turn({ input: `OVERFLOW ${'x'.repeat(40)}`, session: 'big' });
  assert.match(r.text, /context|shorter|smaller/i, r.text);
  assert.equal(r.errorKind, 'toobig');
});

test('an unreachable endpoint is "I cannot reach it", never "fetch failed"', async () => {
  const { r } = await turnWith('good-key', { session: 'net', baseUrl: 'http://127.0.0.1:9' });
  assert.match(r.text, /reach|internet|connection/i, r.text);
  assert.doesNotMatch(r.text, /fetch failed|ECONNREFUSED|Provider error after/, r.text);
  assert.equal(r.errorKind, 'unreachable');
});

test('explainError: the sentences live in one place and stay short', () => {
  const mk = (o) => Object.assign(new Error(o.message), o.status ? { status: o.status } : {}, o.cause ? { cause: o.cause } : {});
  const route = { providerName: 'deepseek', model: 'deepseek-flash', label: 'DeepSeek' };
  const cases = [
    [mk({ status: 401, message: '401: invalid or missing API key' }), 'auth', /api key/i, true],
    [mk({ status: 403, message: '403: Forbidden' }), 'auth', /key|permission/i, true],
    [mk({ status: 402, message: '402: Insufficient balance' }), 'billing', /credit/i, false],
    [mk({ status: 404, message: '404: unknown model' }), 'model', /model/i, false],
    [mk({ message: 'fetch failed', cause: { code: 'ENOTFOUND' } }), 'unreachable', /reach|internet|connection/i, false],
    [mk({ message: 'connect ECONNREFUSED 127.0.0.1:9' }), 'unreachable', /reach|internet|address/i, false],
    [mk({ message: 'timeout of 180000ms exceeded' }), 'unreachable', /reach|slow|timeout/i, false],
  ];
  for (const [err, kind, re, needsKey] of cases) {
    const out = explainError(err, route);
    assert.equal(out.kind, kind, `${err.message} → kind`);
    assert.match(out.human, re, `${err.message} → human`);
    assert.equal(out.needsKey, needsKey, `${kind} needsKey`);
    assert.ok(out.human.length < 260, `sentence too long (${out.human.length}): ${out.human}`);
    assert.doesNotMatch(out.human, /Provider error after|\[object|undefined|null/, out.human);
    assert.equal(typeof out.retryable, 'boolean');
  }
  const up = explainError(mk({ status: 502, message: '502: Bad gateway' }), route);
  assert.equal(up.kind, 'upstream', 'a real provider fault stays honest');
  assert.equal(up.retryable, true, '502 must still be retried');
  assert.match(up.human, /DeepSeek/, 'and name who is at fault');
  assert.match(up.human, /try again|later/i, 'and say what happens next');
});

/* ---------------- 2) väljaren: alla presets + egen adress, inga config-filer ---------------- */
test('state: the panel gets the full preset list so nothing is hardcoded in the UI', async () => {
  const rt = await createRuntime({ channels: false, scheduler: false });
  const st = rt.state({ includeTools: false });
  assert.ok(Array.isArray(st.presets) && st.presets.length >= 11, `presets in state (got ${st.presets?.length})`);
  const kilo = st.presets.find((p) => p.name === 'kilocode');
  assert.ok(kilo, 'Kilo Gateway must be pickable without touching a config file');
  assert.equal(kilo.label, 'Kilo Gateway');
  assert.equal(kilo.needsKey, true);
  assert.match(kilo.baseUrl, /^https:\/\//);
  assert.deepEqual(Object.keys(kilo).sort(), ['baseUrl', 'keyUrl', 'label', 'models', 'name', 'needsKey'].sort(), 'only what the card needs, nothing else');
  assert.equal(st.presets.find((p) => p.name === 'mock').needsKey, false, 'the demo stays selectable with no key');
  assert.ok(st.presets.every((p) => p.label && !/[åäö]/.test(p.label)), 'labels are English (the old presets had "lokalt")');
});

test('panel: picker from state, an address field, and a warning when the box is empty', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/ui/panels.js'), 'utf8');
  assert.match(src, /st\.presets/, 'the dropdown must come from st.presets');
  assert.doesNotMatch(src, /\[\s*'deepseek',\s*'openrouter'/, 'no frozen provider list in the UI');
  assert.match(src, /baseUrl/, 'a user must be able to point at their own machine from the browser');
  assert.match(src, /paste the key|paste a key|no key/i, 'saving with an empty box has to say so');
});

/* ---------------- 3) sparandet från webbläsaren, och att det lever kvar ---------------- */
let proc = null;
let PORT = 0;
const TOKEN = 'onbtok';

async function pickPort() {
  const srv = net.createServer();
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  await new Promise((res) => srv.close(res));
  return port;
}

async function req(p, { method = 'GET', body } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

before(async () => {
  PORT = await pickPort();
  proc = spawn(process.execPath, [path.join(ROOT, 'src/cli/majin.js'), 'serve', '--no-browser', '--channels=false', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, MAJIN_HOME: home, MAJIN_TOKEN: TOKEN, MAJIN_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      if (r.ok) return;
    } catch { /* inte uppe än */ }
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error('the server never came up');
});

after(async () => {
  proc?.kill('SIGTERM');
  probe.close();
  for (let i = 0; i < 12; i++) {
    try { fs.rmSync(home, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 }); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
});

test('saving a provider from the browser: empty key refused, demo allowed, own address saved and kept', async () => {
  const empty = await req('/api/provider', { method: 'POST', body: { preset: 'deepseek' } });
  assert.notEqual(empty.json.ok, true, 'a save with no key must not report success');
  assert.match(String(empty.json.error || ''), /key/i, `say what is missing: ${JSON.stringify(empty.json)}`);

  const demo = await req('/api/provider', { method: 'POST', body: { preset: 'mock' } });
  assert.equal(demo.json.ok, true, 'the demo stays selectable without a key');

  const kilo = await req('/api/provider', { method: 'POST', body: { preset: 'kilocode', apiKey: 'eyJtest.test.test' } });
  assert.equal(kilo.json.ok, true, JSON.stringify(kilo.json));
  assert.match(String(kilo.json.status?.baseUrl || kilo.json.provider?.baseUrl || ''), /kilo/, 'the preset brings its own base url');

  const own = await req('/api/provider', { method: 'POST', body: { name: 'home', baseUrl: 'http://192.168.1.20:11434/v1', apiKey: 'no-key-needed', model: 'qwen' } });
  assert.equal(own.json.ok, true, JSON.stringify(own.json));
  const onDisk = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  assert.equal(onDisk.providers?.home?.baseUrl, 'http://192.168.1.20:11434/v1', 'your own machine, from the browser, written to disk — so a restart keeps it');
  const st = await req('/api/state?tools=0');
  const row = (st.json.providers || []).find((x) => x.name === 'home');
  assert.equal(row?.baseUrl, 'http://192.168.1.20:11434/v1', 'and the card shows it back');
  assert.equal(st.json.needsSetup, false, 'a pasted key ends setup mode — the banner must stop nagging');

  /* och felmeddelandet från gatewayen når webbläsaren i samma form */
  await req('/api/config', { method: 'PATCH', body: { providers: { deepseek: { baseUrl: PROBE, apiKey: 'bad-key', models: ['probe/small'] } }, models: { provider: 'deepseek', routes: Object.fromEntries(JOBS.map((j) => [j, 'deepseek/probe/small'])) }, moa: { policy: 'off' } } });
  const chat = await req('/api/chat', { method: 'POST', body: { input: 'hej', stream: false, session: 'ui-auth' } });
  assert.match(String(chat.json.text), /api key/i, JSON.stringify(chat.json).slice(0, 200));
  assert.equal(chat.json.errorKind, 'auth', 'the UI can show the right card because the kind travels');
  assert.match(String(chat.json.errorHint || ''), /key/i, 'and the short fix travels too');
});
