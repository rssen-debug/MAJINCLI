/* MAJIN — servern: autentisering, SPA-utservering, SSE, JSON-felkontrakt.
   Startar en riktig process på en udda port, samma kodväg som en webbläsare använder. */
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';

const ROOT = path.resolve(import.meta.dirname, '..');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-http-'));
const TOKEN = 'testtok';
let PORT = 0;
const base = (p) => `http://127.0.0.1:${PORT}${p}`;
let proc = null;
let log = '';

async function free(port = 0) {
  return new Promise((res) => {
    const s = net.createServer();
    s.once('error', () => res(false));
    s.once('listening', () => s.close(() => res(true)));
    s.listen(port, '127.0.0.1');
  });
}

function rawReq(p, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
const rawGet = (p, headers) => rawReq(p, { headers });

async function get(p, opts = {}) {
  const r = await fetch(base(p), { ...opts, redirect: 'manual' });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, headers: r.headers, body: buf.toString('utf8'), bytes: buf };
}

async function pickPort() {
  const srv = net.createServer();
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  await new Promise((res) => srv.close(res));
  return port;
}

async function waitUp(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(base('/healthz'));
      if (r.ok) return true;
    } catch {
      /* ej uppe än */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`the server did not come up:\n${log}`);
}

before(async () => {
  PORT = await pickPort();
  assert.equal(await free(PORT), true, `port ${PORT} must be free`);
  // En nyckel i hemmet stänger av förstakörningssidans "key required"-gate och
  // ger oss något att bevisa att /api/config rödar nycklar.
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({
    providers: { openai: { apiKey: 'sk-test-seed-1234' } },
    models: { provider: 'openai' },
    workspace: path.join(home, 'workspace'),
    server: { port: PORT, token: TOKEN },
  }));
  proc = spawn(process.execPath, [path.join(ROOT, 'src/cli/majin.js'), 'serve', '--no-browser', '--channels=false', '--host', '127.0.0.1', '--port', String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, MAJIN_HOME: home, MAJIN_TOKEN: TOKEN, MAJIN_PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout.on('data', (c) => { log += c; });
  proc.stderr.on('data', (c) => { log += c; });
  await waitUp();
});

after(async () => {
  if (proc && proc.exitCode === null) proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 250));
  fs.rmSync(home, { recursive: true, force: true });
});

test('/healthz and /api/hello stay open', async () => {
  const h = await get('/healthz');
  assert.equal(h.status, 200);
  assert.equal(JSON.parse(h.body).ok, true);
  const hello = await get('/api/hello?t=nej');
  assert.equal(hello.status, 200);
  assert.equal(JSON.parse(hello.body).name, 'MAJIN');
});

test('SPA: index, /panel deep links and logo.png are served', async () => {
  const html = await get('/');
  assert.equal(html.status, 200);
  assert.match(html.headers.get('content-type'), /text\/html/);
  assert.match(html.body, /MAJIN/, 'the brand must be in the html');
  assert.match(html.body, /id="c-wa"/, 'the whatsapp chip must exist in index');
  assert.match(html.body, /id="brand"/, 'the brand in the header');
  assert.match(html.body, /rel="icon"/, 'favicon-länk måste finnas');
  assert.match(html.body, /app\.js/, 'no ES modules or bundlers — classic script');
  const panel = await get('/panel');
  assert.equal(panel.status, 200, 'SPA deep links must fall back to index');
  assert.match(panel.body, /id="c-wa"/, 'the fallback must be the real UI');
  const logo = await get('/logo.png');
  assert.equal(logo.status, 200, 'logo.png must be served');
  assert.match(logo.headers.get('content-type'), /image\/png/);
  assert.equal(logo.bytes.readUInt32BE(0), 0x89504e47, 'logo måste vara en riktig PNG');
  assert.ok(logo.bytes.length > 4096, 'the logo must not be a stub');
  const js = await get('/app.js');
  assert.equal(js.status, 200);
  assert.match(js.headers.get('content-type'), /javascript/, 'app.js must be served as javascript');
  const panels = await get('/panels.js');
  assert.equal(panels.status, 200, 'panels.js must ship too');
  const missing = await get('/finns-inte.png');
  assert.equal(missing.status, 404);
  assert.match(missing.body, /not found/, 'the 404 must be English');
  const trav = await rawReq('/../../etc/passwd');
  assert.doesNotMatch(trav.body, /root:.*:0:0:/, 'path traversal must not leak /etc/passwd');
  const trav2 = await rawReq('/api/../../etc/passwd');
  assert.doesNotMatch(trav2.body, /root:.*:0:0:/, 'also via the api path');
});

test('token: query, header, cookie — and refusal from outside', async () => {
  const noAuth = await get('/api/state');
  assert.equal(noAuth.status, 200, 'loopback is trusted by default (server.trustLocal)');
  const evil = await rawGet('/api/state', { Host: 'evil.example' });
  assert.equal(evil.status, 401, 'an alien host without a token must be refused');
  assert.equal(JSON.parse(evil.body).error, 'token required');
  assert.match(evil.body, /\?t=/, 'the 401 must say how to authenticate');
  for (const [label, opts] of Object.entries({
    q: { headers: { Host: 'evil.example' } },
  })) {
    const withQuery = await rawGet(`/api/state?t=${TOKEN}`, { Host: 'evil.example' });
    assert.equal(withQuery.status, 200, 'a token in the query must work');
    assert.equal((await rawGet('/api/state', { Host: 'evil.example', authorization: `Bearer ${TOKEN}` })).status, 200, 'bearer must work');
    assert.equal((await rawGet('/api/state', { Host: 'evil.example', cookie: `majin=${TOKEN}` })).status, 200, 'the cookie must work');
    assert.equal((await rawGet('/api/state', { Host: 'evil.example', 'x-majin-token': TOKEN })).status, 200, 'x-majin-token must work');
    assert.equal((await rawGet('/api/state?t=fel', { Host: 'evil.example' })).status, 401, 'a wrong token must be refused');
    assert.equal((await rawReq('/api/chat', { method: 'POST', headers: { Host: 'evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 401, 'alien host without a token must be refused');
  }
});

test('/api/state and /api/config: right shape and redacted keys', async () => {
  const st = JSON.parse((await get(`/api/state?t=${TOKEN}`)).body);
  assert.equal(st.version, JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, 'the app must report the version it was released as');
  assert.equal(st.name, 'MAJIN');
  assert.equal(st.tools.length, 85, 'state must list every tool');
  assert.equal(JSON.parse((await get(`/api/state?tools=0&t=${TOKEN}`)).body).tools.count, 85);
  assert.ok(st.groups.reverse.length >= 20, 'groups for the UI');
  assert.equal(st.guard.mode, 'confirm', 'the default mode is confirm');
  assert.ok(Array.isArray(st.routes) && st.routes.some((r) => r.job === 'tasks' && r.ref), 'the route table must exist');
  const cfg = JSON.parse((await get(`/api/config?t=${TOKEN}`)).body);
  assert.equal(cfg.ok, true);
  assert.ok(!JSON.stringify(cfg).includes('sk-test-seed'), 'real keys must not leak');
  assert.match(JSON.stringify(cfg), /set|\*\*\*|redacted/i, 'the redacted marker must still be visible');
  const bad = await get(`/api/config?t=${TOKEN}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"workspace":' });
  assert.ok([400, 422].includes(bad.status), `broken JSON must be refused, got  ${bad.status}`);
  assert.ok(JSON.parse(bad.body).errors, 'the 400 must carry field errors');
  const unknown = await get(`/api/config?t=${TOKEN}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: 1 }) });
  assert.ok(unknown.body.includes('nope'), 'the unknown key must be named in the error');
});

test('/api/chat: demo answer without stream, 400 on empty input', async () => {
  const sw = await get(`/api/config?t=${TOKEN}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ models: { provider: 'demo', routes: { chat: 'demo/demo-fast' } } }) });
  assert.equal(sw.status, 200, JSON.stringify(sw.body).slice(0, 200));
  const post = async (payload) => {
    const r = await fetch(base(`/api/chat?stream=false&t=${TOKEN}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const txt = await r.text();
    let json = null;
    try { json = JSON.parse(txt); } catch { /* icke-json */ }
    return { status: r.status, json, txt };
  };
  const a = await post({ input: 'hej där', session: 'http', stream: false });
  assert.equal(a.status, 200, a.txt.slice(0, 200));
  assert.equal(a.json.ok, true, JSON.stringify(a.json).slice(0, 240));
  const b = await post({ prompt: 'alias-formen', session: 'http', stream: false });
  assert.equal(b.status, 200, 'prompt must be accepted as an alias');
  const c = await post({ messages: [{ role: 'user', content: 'meddelande-formen' }], session: 'http', stream: false });
  assert.equal(c.status, 200, 'messages[] must be accepted');
  const streamForm = await fetch(base(`/api/chat?stream=false&t=${TOKEN}`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: 'query-formen', session: 'http' }) });
  assert.equal(streamForm.status, 200);
  assert.match(streamForm.headers.get('content-type') || '', /application\/json/, '?stream=false must give JSON, not SSE');
  await streamForm.text();
  const empty = await post({});
  assert.equal(empty.status, 400);
  assert.match(JSON.stringify(empty.json), /empty input/, 'the 400 must explain');
});

test('/api/events: SSE headers, retry and streaming events', async () => {
  const ac = new AbortController();
  const res = await fetch(base(`/api/events?t=${TOKEN}`), { headers: { accept: 'text/event-stream' }, signal: ac.signal });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(res.headers.get('cache-control'), 'no-cache, no-transform');
  assert.equal(res.headers.get('x-accel-buffering'), 'no', 'proxies must not buffer the stream');
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const head = Buffer.from(value).toString('utf8');
  assert.match(head, /retry: 15000/, 'the reconnect directive must exist');
  // trigga ett event och läsa det
  await get(`/api/config?t=${TOKEN}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ui: { theme: 'jarvis' } }) });
  let rest = '';
  for (let i = 0; i < 6 && !/event: /.test(rest); i += 1) {
    const r = await reader.read();
    if (r.done) break;
    rest += Buffer.from(r.value).toString('utf8');
  }
  assert.match(rest, /event: /, 'events must stream');
  ac.abort();
});

test('authOk: the trusted-host rule cannot be reached from outside', async () => {
  const { authOk } = await import('../src/core/server/index.js');
  const cfg = { get: (k) => ({ 'server.trustLocal': true, 'server.allowRemote': false })[k] };
  const url = new URL('http://localhost:8787/api/state');
  const req = (host) => ({ headers: { host } });
  assert.equal(authOk(req('localhost:8787'), url, 'sekret', cfg, '127.0.0.1'), true, 'loopback peer + local host = no token');
  assert.equal(authOk(req('localhost:8787'), url, 'sekret', cfg, '10.0.0.5'), false, 'DNS rebinding: local Host from a remote peer must be refused');
  assert.equal(authOk(req('evil.example'), url, 'sekret', cfg, '127.0.0.1'), false, 'alien host needs the token');
  assert.equal(authOk(req('evil.example'), new URL('http://evil.example/api/state?t=sekret'), 'sekret', cfg, '10.0.0.5'), true, 'a token always works');
  assert.equal(authOk(req('evil.example'), url, '', cfg, '10.0.0.5'), true, 'no token configured = open (fresh install, loopback only)');
  const noTrust = { get: (k) => ({ 'server.trustLocal': false, 'server.allowRemote': false })[k] };
  assert.equal(authOk(req('localhost'), url, 'sekret', noTrust, '127.0.0.1'), false, 'trustLocal:false måste gälla även lokalt');
});

test('/api/keys/claim + /api/tool: pairing flow and tool calls', async () => {
  const pair = JSON.parse((await get(`/api/keys/pair?t=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).body);
  assert.match(String(pair.code), /^[A-Za-z0-9]{6,}$/, 'a one-time code must exist');
  assert.equal(pair.expiresSec, 300);
  assert.match(pair.url, /\?t=/, 'the pair URL must carry the token');
  const claim = await fetch(base(`/api/keys/claim?code=${pair.code}&provider=openai&key=sk-test-1234`), { method: 'POST' });
  assert.equal(claim.status, 200, 'claim must work without a token');
  const st = JSON.parse((await get(`/api/state?t=${TOKEN}`)).body);
  const openai = st.providers.find((p) => p.name === 'openai');
  assert.equal(openai.hasKey, true, 'the key must be stored');
  assert.equal(openai.ready, true, 'the provider must become ready from the paired key');
  assert.equal(JSON.parse((await get(`/api/state?t=${TOKEN}`)).body).needsSetup, false, 'the first-run gate must open');
  const again = await fetch(base(`/api/keys/claim?code=${pair.code}&provider=openai&key=sk-test-1234`), { method: 'POST' });
  assert.notEqual(again.status, 200, 'the one-time code must be single use');
  const tool = JSON.parse((await get(`/api/tool?t=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'fs.write', args: { path: 'http-prov.txt', content: 'från http\n' } }) })).body);
  assert.equal(tool.ok, true, JSON.stringify(tool));
  assert.ok(fs.existsSync(path.join(home, 'workspace', 'http-prov.txt')), 'the tool must write in the workspace');
  const badTool = JSON.parse((await get(`/api/tool?t=${TOKEN}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'nsaknas' }) })).body);
  assert.equal(badTool.error.code, 'unknown_tool');
  assert.match(badTool.error.message, /does not exist|finns inte/);
});
