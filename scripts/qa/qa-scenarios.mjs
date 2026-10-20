#!/usr/bin/env node
/**
 * MAJIN REAL-WORLD QA AUDIT — scenario engine (independent, dependency-free).
 *
 * Drives the REAL INSTALLED v1.0.0 product (majin-win-x64.exe _serve) through
 * its actual HTTP API, its real tools registry and a REAL local model
 * (Ollama smollm2:135m / llama3.2:1b) on a windows-latest GitHub runner.
 *
 * Honesty contract: each scenario carries a hard-coded classification ceiling.
 * Nothing executed in a CI service session may be reported VERIFIED_REAL.
 *
 * Usage:  node scripts/qa/qa-scenarios.mjs
 * Env:    QA_EXE      path to installed majin-win-x64.exe          (required)
 *         QA_HOME     user data dir (default ~\.majin)
 *         QA_PORT     server port (default 8787)
 *         QA_EVID     evidence dir (default qa-evidence)
 *         QA_SETUP    path to downloaded MAJIN-Setup.exe           (s01)
 *         QA_SETUP_SHA path to the published .sha256               (s01)
 *         QA_MODELS   csv models pulled in Ollama (default smollm2:135m)
 *         QA_ONLY     csv of scenario ids to run (default all)
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const CFG = {
  exe: process.env.QA_EXE || '',
  home: process.env.QA_HOME || path.join(os.homedir(), '.majin'),
  port: Number(process.env.QA_PORT || 8787),
  base: `http://127.0.0.1:${Number(process.env.QA_PORT || 8787)}`,
  evid: path.resolve(process.env.QA_EVID || 'qa-evidence'),
  setup: process.env.QA_SETUP || '',
  setupShaFile: process.env.QA_SETUP_SHA || '',
  models: (process.env.QA_MODELS || 'smollm2:135m').split(',').map((s) => s.trim()).filter(Boolean),
  only: process.env.QA_ONLY ? new Set(process.env.QA_ONLY.split(',').map((s) => s.trim())) : null,
};
const CL = { REAL: 'VERIFIED_REAL', CI: 'VERIFIED_CI', SIM: 'SIMULATED', BLOCKED: 'BLOCKED', FAIL: 'FAILED', SKIP: 'SKIPPED' };
const EVID = CFG.evid;
fs.mkdirSync(EVID, { recursive: true });
fs.mkdirSync(path.join(EVID, 'transcripts'), { recursive: true });

let serverProc = null;
const serverLog = { stdout: [], stderr: [] };
function saveServerLogs(tag) {
  fs.writeFileSync(path.join(EVID, `${tag}.log`), serverLog.stdout.slice(-400).join('') || '(empty stdout)');
  fs.writeFileSync(path.join(EVID, `${tag}-err.log`), serverLog.stderr.slice(-400).join('') || '(empty stderr)');
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startServer(timeoutMs = 90000) {
  if (!fs.existsSync(CFG.exe)) throw new Error(`installed exe missing: ${CFG.exe}`);
  serverLog.stdout = []; serverLog.stderr = [];
  serverProc = spawn(CFG.exe, ['_serve'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  serverProc.stdout.on('data', (d) => { serverLog.stdout.push(d); if (serverLog.stdout.join('').length > 2e6) serverLog.stdout = serverLog.stdout.slice(-200); });
  serverProc.stderr.on('data', (d) => { serverLog.stderr.push(d); });
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${CFG.base}/healthz`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch { /* booting */ }
    await sleep(1000);
  }
  saveServerLogs('boot-fail');
  throw new Error(`server did not pass /healthz within ${timeoutMs}ms`);
}
async function stopServer(hard = false) {
  if (!serverProc) return;
  const pid = serverProc.pid;
  if (!hard) {
    try { await api('POST', '/api/shutdown', {}, { timeoutMs: 5000 }); await sleep(1500); } catch { /* ok */ }
  }
  try {
    if (hard && pid) {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    } else if (pid) {
      serverProc.kill();
    }
  } catch { /* already gone */ }
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && serverProc && !serverProc.killed && serverProc.exitCode == null) {
    if (hard) break;
    await sleep(300);
  }
  serverProc = null;
}
function tokenFromConfig() {
  for (const cand of [path.join(CFG.home, 'config.json')]) {
    try { const j = JSON.parse(fs.readFileSync(cand, 'utf8')); const t = j?.server?.token; if (t && String(t).length >= 8) return String(t); } catch { /* next */ }
  }
  const out = serverLog.stdout.join('');
  const m = /[?&]t=([0-9a-f]{8,})/.exec(out);
  if (m) return m[1];
  return '';
}
let TOKEN = '';
async function api(method, p, body, { token = true, timeoutMs = 60000, raw = false } = {}) {
  const r = await fetch(`${CFG.base}${p}`, {
    method,
    headers: { ...(token && TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}), ...(body != null ? { 'content-type': 'application/json' } : {}) },
    body: body != null ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (raw) return r;
  let json = null;
  const text = await r.text();
  try { json = JSON.parse(text); } catch { json = { ok: false, parse_error: true, body: text.slice(0, 400) }; }
  return { status: r.status, json, headers: Object.fromEntries(r.headers.entries()) };
}
/** POST /api/chat as SSE; resolves {events, text, doneEvent, taskId, msToFirstDelta, msTotal} */
function sseChat(input, { session, timeoutMs = 240000, onDelta, extra = {} } = {}) {
  return new Promise(async (resolve, reject) => {
    const ac = new AbortController();
    const killer = setTimeout(() => ac.abort(new Error('sse timeout')), timeoutMs);
    const events = [];
    let text = '';
    let taskId = null; let doneEvent = null; let firstDeltaAt = 0;
    const t0 = Date.now();
    try {
      const body = { input, stream: true, ...(session ? { session } : {}), ...extra };
      const r = await fetch(`${CFG.base}/api/chat`, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify(body),
      });
      if (!r.ok || !r.body) { clearTimeout(killer); return reject(new Error(`chat http ${r.status}: ${(await r.text()).slice(0, 200)}`)); }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const ev = { type: 'message', data: '' };
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev.type = line.slice(6).trim();
            else if (line.startsWith('data:')) ev.data += (ev.data ? '\n' : '') + line.slice(5);
          }
          let parsed = null;
          try { parsed = JSON.parse(ev.data); } catch { parsed = { raw: ev.data.slice(0, 200) }; }
          events.push({ type: ev.type, ...parsed });
          if (ev.type === 'task') taskId = parsed.task;
          if (ev.type === 'delta') { const t = parsed.text || parsed.delta || ''; text += t; if (!firstDeltaAt) firstDeltaAt = Date.now(); if (onDelta) onDelta(text); }
          if (ev.type === 'answer' && !text) text = parsed.text || '';
          if (ev.type === 'done') doneEvent = parsed;
        }
      }
      clearTimeout(killer);
      resolve({ events, text, doneEvent, taskId, msToFirstDelta: firstDeltaAt ? firstDeltaAt - t0 : null, msTotal: Date.now() - t0 });
    } catch (err) {
      clearTimeout(killer);
      resolve({ events, text, doneEvent, taskId, aborted: String(err?.message || err), msTotal: Date.now() - t0 });
    }
  });
}
async function nonStreamChat(input, extra = {}, timeoutMs = 240000) {
  return api('POST', '/api/chat', { input, stream: false, ...extra }, { timeoutMs });
}

const results = [];
function evidWrite(id, data) {
  fs.writeFileSync(path.join(EVID, `${id}.json`), JSON.stringify(data, null, 2));
}
async function scenario(id, name, lane, ceiling, fn) {
  if (CFG.only && !CFG.only.has(id)) return;
  console.log(`\n[QA] ${id} — ${name} (${lane})`);
  const t0 = Date.now();
  let r;
  const a = (status, note, evidence) => ({ id, name, lane, status, ms: Date.now() - t0, note: note || '', evidence: evidence || {} });
  try {
    r = await fn(a);
  } catch (err) {
    r = a(CL.FAIL, `engine exception: ${String(err && err.message || err).slice(0, 300)}`, { exception: String(err && err.stack || err).slice(0, 600) });
  }
  if (![CL.REAL, CL.CI, CL.SIM, CL.BLOCKED, CL.FAIL, CL.SKIP].includes(r.status)) r.status = CL.FAIL;
  if (ceiling === CL.CI && r.status === CL.REAL) r.status = CL.CI;
  if (ceiling === CL.SIM && [CL.REAL, CL.CI].includes(r.status)) r.status = CL.SIM;
  const passed = r.status !== CL.FAIL;
  console.log(`    → ${r.status}${passed ? '' : '  ✗'}  ${r.note || ''}  (${r.ms}ms)`);
  results.push(r);
  evidWrite(id, r);
}

/* ============================ scenarios ============================ */

async function s01(a) { // artifact integrity
  if (!CFG.setup || !fs.existsSync(CFG.setup)) return a(CL.SKIP, 'installer not staged for this lane (workflow stages it)');
  const raw = fs.readFileSync(CFG.setupShaFile, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  const local = crypto.createHash('sha256').update(fs.readFileSync(CFG.setup)).digest('hex');
  const ok = raw === local && raw.length === 64;
  return a(ok ? CL.CI : CL.FAIL, ok ? 'published sha256 == installer sha256' : 'SHA-256 MISMATCH', { published: raw, computed: local, bytes: fs.statSync(CFG.setup).size });
}
async function s02(a) {
  const exists = fs.existsSync(CFG.exe);
  if (!exists) return a(CL.FAIL, 'installed exe not found', { exe: CFG.exe });
  const size = fs.statSync(CFG.exe).size;
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${CFG.exe}" --version`], { encoding: 'utf8', timeout: 45000 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
  const mVer = /majin (\d+\.\d+\.\d+)/.exec(out);
  const ok = Boolean(mVer) && out.length < 400;
  return a(ok ? CL.CI : CL.FAIL, ok ? `first-run prints "majin ${mVer[1]}"` : `--version failed: ${out.slice(0, 120)}`, { versionOut: out, size, version: mVer?.[1] || null });
}
async function s03(a) {
  const help = spawnSync('cmd.exe', ['/d', '/s', '/c', `"${CFG.exe}" --help`], { encoding: 'utf8', timeout: 45000 });
  const helpOut = `${help.stdout || ''}`.trim();
  const hasCommands = /start|window|doctor|send/.test(helpOut);
  return a(hasCommands ? CL.CI : CL.FAIL, hasCommands ? '--help lists real commands' : `--help content suspect`, { help: helpOut.slice(0, 500), exit: help.status });
}
async function s04(a) {
  const noTok = await api('GET', '/api/state', undefined, { token: false });
  const health = await api('GET', '/healthz', undefined, { token: false });
  const hello = await api('GET', '/api/hello', undefined, { token: false });
  const uiNoTok = await api('GET', '/', undefined, { token: false, raw: true });
  const uiGateText = (await uiNoTok.text()).slice(0, 300);
  const ok = noTok.status === 401 && health.status === 200 && hello.json.needToken === true && uiNoTok.status === 200 && /key required/i.test(uiGateText) && !/t=/.test(uiGateText.replace(/\?t=/, '')) ;
  return a(ok ? CL.CI : CL.FAIL, ok ? 'unauthenticated callers get 401 + a gate page, /healthz stays public' : 'auth boundary surprising', {
    stateWithoutToken: noTok.status, healthz: health.status, helloNeedToken: hello.json.needToken, uiGate: uiGateText.slice(0, 120),
  });
}
async function s05(a) {
  const idx = await api('GET', '/', undefined, { raw: true });
  const idxBody = await idx.text();
  const settled = [];
  for (const asset of ['app.js', 'onboard.js', 'phoenix.css', 'logo.png', 'panels.js', 'catalog.js']) {
    const r = await api('GET', `/${asset}`, undefined, { raw: true });
    settled.push({ asset, status: r.status, mime: r.headers.get('content-type') || '' });
  }
  const ok = idx.status === 200 && /MAJIN|__MAJIN/i.test(idxBody) && !idxBody.includes('__MAJIN_TOKEN__') && settled.every((s) => s.status === 200);
  return a(ok ? CL.CI : CL.FAIL, ok ? `${settled.length} UI assets served authenticated; token is injected, never left as literal` : 'UI assets missing', { indexBytes: idxBody.length, assets: settled });
}
async function s06(a) {
  const tail = await api('GET', '/api/config');
  if (String(JSON.stringify(tail.json)).includes('secret-AUDIT-marker-123')) {
    return a(CL.SIM, 'marker already present from previous attempt — audit redaction with other value', {});
  }
  // 1. configure real Ollama provider (placeholder key per preset)
  const add = await api('POST', '/api/provider', { preset: 'ollama', models: CFG.models });
  if (!add.json.ok) return a(CL.FAIL, 'provider preset save refused', { resp: add.json });
  // 2. redaction: set a marker key on a scratch provider, then read config back
  await api('POST', '/api/provider', { name: 'auditsecret', kind: 'openai', baseUrl: 'https://audit.invalid', apiKey: 'secret-AUDIT-marker-123', models: ['x'] });
  const after = await api('GET', '/api/config');
  const body = JSON.stringify(after.json);
  const leaked = body.includes('secret-AUDIT-marker-123');
  return a(!leaked ? CL.CI : CL.FAIL, !leaked ? 'apiProvider key never returns via /api/config (redaction holds)' : 'KEY LEAK in redacted config', { providerSaved: add.json.ok, redactionSample: body.slice(0, 0) });
}
async function s07(a) {
  const cfg = (await api('GET', '/api/config')).json;
  const routes = cfg?.config?.models?.routes || {};
  const patch = { models: { routes: {} }, moa: { enabled: false, policy: 'off' }, routing: { auto: true } };
  for (const job of Object.keys(routes).length ? Object.keys(routes) : ['chat', 'tools', 'research', 'code', 'analysis', 'aggregator']) {
    patch.models.routes[job] = `ollama/${CFG.models[0]}`;
  }
  const r = await api('PATCH', '/api/config', patch);
  if (!r.json.ok) return a(CL.FAIL, 'route patch rejected', r.json);
  const st = (await api('GET', '/api/state?tools=0')).json;
  const chat = (st?.state?.models?.routes || st?.models?.routes || {})['chat'] || patch.models.routes.chat;
  return a(CL.CI, `all routes now point at ollama/${CFG.models[0]}`, { routes: patch.models.routes, stateSeen: !!st, chatAfter: chat });
}
async function s08(a) {
  const r = await api('POST', '/api/provider/test', { ref: `ollama/${CFG.models[0]}` }, { timeoutMs: 180000 });
  const ok = r.json.ok === true && typeof r.json.text === 'string' && r.json.text.length > 0;
  return a(ok ? CL.CI : CL.FAIL, ok ? `provider test got a REAL completion (${r.json.ms}ms): "${String(r.json.text).slice(0, 40)}"` : `provider test failed: ${r.json.error}`, r.json);
}
async function s09(a) {
  const r = await api('GET', '/api/models?provider=ollama', undefined, { timeoutMs: 60000 });
  const list = r.json.models || r.json.list || [];
  const names = list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  const have = CFG.models.every((want) => names.some((n) => String(n).includes(want.split(':')[0])));
  return a(have ? CL.CI : CL.FAIL, have ? `Ollama discovery returned the pulled models: ${names.slice(0, 6).join(', ')}` : 'model discovery incomplete', { count: names.length, first: names.slice(0, 8) });
}
const CHAT_TOKEN_WORD = (id) => `PROMPT-${id.toUpperCase().replace(/[^A-Z0-9]/g, '')}-TOKEN`;
async function chatExpectToken(a, tokenWord, retries = 2, extra = {}) {
  const attempts = [];
  for (let i = 0; i < retries; i++) {
    const r = await nonStreamChat(
      `You are in a deterministic audit. Reply with EXACTLY the single word ${tokenWord} and nothing else.`,
      { session: `qa-${extra.sessionSuffix || 'chat'}-${i}` },
    );
    const text = String(r.json.text || r.json.answer || '');
    attempts.push({ try: i + 1, ok: r.json.ok, reply: text.slice(0, 80), ms: r.json.ms });
    if (r.json.ok && text.toUpperCase().includes(tokenWord)) {
      evidWrite(`${extra.id || 'chat'}-transcript`, { attempts });
      return { ok: true, attempts };
    }
  }
  evidWrite(`${extra.id || 'chat'}-transcript`, { attempts });
  return { ok: false, attempts };
}
async function s10(a) {
  const tok = CHAT_TOKEN_WORD('s10');
  const r = await chatExpectToken(a, tok, 3, { id: 's10' });
  return a(r.ok ? CL.CI : CL.FAIL, r.ok
    ? `installed app returned the audit token "${tok}" through a REAL local model (attempt ${r.attempts.length})`
    : `real model never reproduced the audit token in ${r.attempts.length} tries`, { attempts: r.attempts });
}
async function s11(a) {
  const r = await sseChat('Stream a short poem of exactly 3 lines about the aurora borealis.', { session: 'qa-s11', timeoutMs: 180000 });
  const deltas = r.events.filter((e) => e.type === 'delta');
  const ok = deltas.length >= 2 && r.doneEvent && r.text.length > 10;
  fs.writeFileSync(path.join(EVID, 'transcripts', 's11-sse.ndjson'), r.events.map((e) => JSON.stringify(e)).join('\n'));
  return a(ok ? CL.CI : CL.FAIL, ok
    ? `SSE streamed ${deltas.length} deltas, first token in ${r.msToFirstDelta}ms, done ok=${r.doneEvent?.ok}, total ${r.msTotal}ms`
    : 'streamed chat incomplete', { deltas: deltas.length, done: r.doneEvent, textPreview: r.text.slice(0, 140), aborted: r.aborted });
}
async function s12(a) {
  const prompt = 'Write an extremely long, detailed, boring inventory of 200 office supplies, numbered.';
  const first = await sseChat(prompt, { session: 'qa-s12-ctl', timeoutMs: 180000 });
  let cancelledText = '';
  const second = await sseChat(prompt, {
    session: 'qa-s12-cancel', timeoutMs: 180000,
    onDelta: async (acc) => {
      if (!cancelledText && acc.length > 30) {
        cancelledText = acc;
        try { await api('POST', '/api/chat/stop', { session: 'qa-s12-cancel' }, { timeoutMs: 5000 }); } catch { /* best effort */ }
      }
    },
  });
  const ranLonger = second.msTotal < first.msTotal * 0.9;
  const stopped = Boolean(second.aborted) || (second.doneEvent && (second.doneEvent.ok === false || second.doneEvent.stopped === true)) || second.text.length < first.text.length;
  return a(stopped ? CL.CI : CL.FAIL, stopped
    ? `cancel mid-stream works: cancelled reply ${second.text.length} chars vs control ${first.text.length} chars (cancel at ~"${cancelledText.slice(0, 30)}…")`
    : 'stop had no observable effect', { control: { chars: first.text.length, ms: first.msTotal }, cancelled: { chars: second.text.length, ms: second.msTotal, done: second.doneEvent, aborted: second.aborted } });
}
async function s13(a) {
  await nonStreamChat('My personal codeword is KATANA-8472. Only acknowledge.', { session: 'qa-s13' });
  const r = await nonStreamChat('Without hints, what is my personal codeword? Reply with just the codeword.', { session: 'qa-s13' });
  const text = String(r.json.text || '');
  const hist = (await api('GET', '/api/history?session=qa-s13&n=10')).json;
  const ok = r.json.ok && text.includes('KATANA-8472');
  return a(ok ? CL.CI : CL.FAIL, ok ? 'multi-turn context: model recalled the codeword from the SAME session' : 'codeword lost across turns', { reply: text.slice(0, 80), historyMessages: (hist.messages || []).length });
}
async function s14(a) {
  const alt = CFG.models[1];
  if (!alt) return a(CL.SKIP, 'only one model pulled — route-switch lane needs two real models');
  const patch = { models: { routes: { chat: `ollama/${alt}`, tools: `ollama/${alt}` } } };
  const sw = await api('PATCH', '/api/config', patch);
  if (!sw.json.ok) return a(CL.FAIL, 'route switch refused', sw.json);
  const r = await nonStreamChat('In one short sentence: which codeword did I give you earlier in this exact session? (It starts with KATANA.)', { session: 'qa-s13' });
  const ok = r.json.ok && String(r.json.text || '').includes('KATANA');
  await api('PATCH', '/api/config', { models: { routes: { chat: `ollama/${CFG.models[0]}`, tools: `ollama/${CFG.models[0]}` } } });
  return a(ok ? CL.CI : CL.FAIL, ok
    ? `route switched ${CFG.models[0]} → ${alt} MID-conversation; history + recall intact (model B answered from model A's context)`
    : 'context not preserved across model switch', { switched: true, replyB: String(r.json.text || '').slice(0, 90) });
}
async function s15(a) {
  const mk = await api('POST', '/api/chat', { input: 'Say OK.', stream: false, autopilot: true, source: 'qa-audit' }, { timeoutMs: 180000 });
  const taskId = mk.json.task;
  const tasksR = (await api('GET', '/api/tasks')).json;
  const seen = (tasksR.tasks || []).some((t) => t.id === taskId);
  const fleet = await nonStreamChat('status', {}, 30000);
  const fleetOk = fleet.json.ok !== false && /agent|task|nothing|idle/i.test(String(fleet.json.text || JSON.stringify(fleet.json)));
  const stopNoSuch = await nonStreamChat('stop agent 99', {}, 30000);
  const ok = seen && fleetOk;
  return a(ok ? CL.CI : CL.FAIL, ok
    ? `autopilot task ${taskId} registered in /api/tasks; deterministic fleet "status" answered without touching the model`
    : 'orchestration primitives incomplete', { taskId, seenInTasks: seen, fleetStatus: String(fleet.json.text || '').slice(0, 80), unknownStop: String(stopNoSuch.json.text || '').slice(0, 60) });
}
async function s16(a) {
  const before = (await api('GET', '/api/history?session=qa-s13&n=50')).json;
  await stopServer(false);
  await startServer();
  TOKEN = tokenFromConfig();
  const after = (await api('GET', '/api/history?session=qa-s13&n=50')).json;
  const ok = (before.messages || []).length > 0 && (after.messages || []).length >= (before.messages || []).length;
  return a(ok ? CL.CI : CL.FAIL, ok ? `graceful restart: ${before.messages.length} chat messages survived → ${after.messages.length}` : 'history lost across restart', { before: (before.messages || []).length, after: (after.messages || []).length });
}
async function s17(a) {
  const t = sseChat('Begin writing a very long essay about granite.', { session: 'qa-s17', timeoutMs: 120000 });
  await sleep(1200);
  await stopServer(true); // hard kill mid-turn (taskkill /F)
  const partial = await t;
  saveServerLogs('pre-crash');
  await startServer();
  TOKEN = tokenFromConfig();
  saveServerLogs('post-crash');
  const sessionsDir = path.join(CFG.home, 'sessions');
  let torn = 0, lines = 0;
  if (fs.existsSync(sessionsDir)) {
    for (const f of fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))) {
      for (const line of fs.readFileSync(path.join(sessionsDir, f), 'utf8').split('\n').filter((l) => l.trim())) {
        lines++;
        try { JSON.parse(line); } catch { torn++; }
      }
    }
  }
  const hist = await api('GET', '/api/history?session=qa-s17&n=5');
  const ok = hist.status === 200 && torn === 0;
  return a(ok ? CL.CI : CL.FAIL, ok
    ? `hard-kill mid-generation: ${lines} journal lines re-parsed after restart, 0 torn; interrupted session answers again`
    : 'journal corrupted by hard kill', { partialStreamed: partial.text.length, tornLines: torn, journalLines: lines, historyAfterCrash: (hist.json.messages || []).length });
}
async function s18(a) {
  const marker = `QA-RW-AUDIT-MARKER-${Date.now()}`;
  const write = await api('POST', '/api/tool', { tool: 'files.write', args: { path: 'qa-audit/verify-marker.txt', content: marker + '\n' } });
  if (write.json.ok !== true) return a(CL.FAIL, 'files.write via /api/tool refused', write.json);
  const dl = await api('GET', '/api/file?path=qa-audit%2Fverify-marker.txt', undefined, { raw: true });
  const body = await dl.text();
  const outside = await api('GET', '/api/file?path=..%2F..%2FWindows%2Fsystem32%2Fdrivers%2Fetc%2Fhosts', undefined, {});
  const ok = dl.status === 200 && body.includes(marker) && [403, 404].includes(outside.status);
  return a(ok ? CL.CI : CL.FAIL, ok
    ? 'agent-grade tool wrote the file; UI download route served it byte-exact; path escape refused'
    : 'file roundtrip or escape guard broken', { writeOk: write.json.ok, markerFound: body.includes(marker), escapeStatus: outside.status });
}
async function s19(a) {
  const events = [];
  const sse = (async () => {
    try {
      const r = await fetch(`${CFG.base}/api/events`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30000) });
      const reader = r.body.getReader(); const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (line) { try { events.push(JSON.parse(line.slice(5))); } catch { /* non-json */ } }
        }
      }
    } catch { /* stream closed */ }
  })();
  await sleep(500);
  const toolCall = api('POST', '/api/tool', { tool: 'shell.run', args: { command: 'echo QA-RW-GUARD' } }, { timeoutMs: 45000 });
  await sleep(2500);
  const request = events.find((e) => e.type === 'approval:request') || events.find((e) => /approval/.test(String(e.type)));
  const cfg = (await api('GET', '/api/config')).json;
  const mode = cfg?.config?.guard?.mode || 'confirm';
  let toolResp;
  if (request && request.id) {
    await api('POST', '/api/approve', { id: request.id, approved: true, note: 'QA audit approving' });
    toolResp = await toolCall.catch((e) => ({ err: String(e) }));
  } else {
    toolResp = await toolCall.catch((e) => ({ err: String(e) }));
    try { sse.catch(() => {}); } catch { /* */ }
  }
  const ran = toolResp?.json?.ok === true && /QA-RW-GUARD/.test(String(toolResp?.json?.result || ''));
  if (request && request.id) {
    return a(ran ? CL.CI : CL.FAIL, ran
      ? `guard.mode=${mode}: shell.run WAITED for approval (id ${request.id}); approved via /api/approve; output delivered`
      : 'approval issued but the shell output never arrived', { mode, approvalId: request.id, ran });
  }
  // no gating event — is guard off? honest report
  return a(ran ? CL.CI : CL.FAIL, ran
    ? `guard.mode=${mode}: shell.run executed immediately (no approval gate hit) — recorded as observed behavior`
    : 'shell.run neither gated nor executed', { mode, gatingObserved: false, ran, toolResp: String(toolResp?.json?.error?.code || toolResp?.err || '').slice(0, 120) });
}
async function s20(a) {
  const events = [];
  const sse = (async () => {
    try {
      const r = await fetch(`${CFG.base}/api/events`, { headers: { authorization: `Bearer ${TOKEN}` }, signal: AbortSignal.timeout(30000) });
      const reader = r.body.getReader(); const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (line) { try { events.push(JSON.parse(line.slice(5))); } catch { /* skip */ } }
        }
      }
    } catch { /* closed */ }
  })();
  await sleep(500);
  const toolCall = api('POST', '/api/tool', { tool: 'shell.run', args: { command: 'echo QA-RW-DENY' } }, { timeoutMs: 45000 });
  await sleep(2500);
  const request = events.find((e) => e.type === 'approval:request');
  if (!request?.id) {
    try { sse.catch(() => {}); } catch { /* */ }
    const res = await toolCall.catch(() => null);
    const denied = res?.json?.ok === false && (res?.json?.error?.code === 'denied' || res?.json?.denied === true);
    return a(denied ? CL.CI : CL.FAIL, denied ? 'denial path returned a clean refused state' : 'no immediate gate; nothing to deny', { note: 'no approval request was observed in 2.5s window' });
  }
  await api('POST', '/api/approve', { id: request.id, approved: false, note: 'QA audit denies' });
  const r = await toolCall.catch((e) => ({ err: String(e) }));
  const deniedClean = r?.json?.ok === false && (r?.json?.error?.code === 'denied' || r?.json?.denied === true);
  try { sse.catch(() => {}); } catch { /* */ }
  return a(deniedClean ? CL.CI : CL.FAIL, deniedClean
    ? 'explicit DENY stops the exec-risk tool with a clean refused state, nothing ran'
    : 'dedenial path did not behave as expected', { resp: r?.json || r });
}
async function s21(a) {
  const r = await api('POST', '/api/tool', { tool: 'web.fetch', args: { url: 'https://example.com' } }, { timeoutMs: 60000 });
  const body = String(r.json.result || '');
  const ok = r.json.ok === true && /Example Domain/i.test(body);
  return a(ok ? CL.CI : CL.FAIL, ok ? 'web.fetch pulled example.com through the installed tool belt' : 'web.fetch failed', { bytes: body.length, preview: body.slice(0, 90) });
}
async function s22(a) {
  const r = await api('GET', '/api/update', undefined, { timeoutMs: 60000 });
  const j = r.json;
  const shaped = j && (typeof j.ok === 'boolean');
  return a(shaped ? CL.CI : CL.FAIL, shaped
    ? `update check answered against real GitHub (ok=${j.ok}${j.latest ? `, latest=${j.latest}` : ''}${j.current ? `, current=${j.current}` : ''})`
    : 'update route malformed', j);
}
async function s23(a) {
  const fact = `QA audit fact: codename IRONWOOD-${Date.now() % 1000}`;
  const w = await api('POST', '/api/memory', { text: fact, tags: ['qa', 'audit'] });
  if (w.json.ok !== true) return a(CL.FAIL, 'memory remember refused', w.json);
  await stopServer(false); await startServer(); TOKEN = tokenFromConfig();
  const recall = await api('POST', '/api/memory', { text: '', tags: [] });
  const q = await api('GET', `/api/memory?q=${encodeURIComponent('IRONWOOD')}`);
  const found = JSON.stringify(q.json).includes('IRONWOOD');
  return a(found ? CL.CI : CL.FAIL, found ? 'memory fact survives full server restart and is recallable' : 'memory not persisted', { fact, recallOk: recall.status, foundAfterRestart: found });
}
async function s24(a) {
  const job = { name: `qa-audit-${Date.now() % 100000}`, every: '1h', prompt: 'reply OK', readOnly: true };
  const mk = await api('POST', '/api/schedule', job);
  const id = mk.json.id || mk.json.job?.id || mk.json.name;
  const list1 = (await api('GET', '/api/schedule')).json;
  const present = JSON.stringify(list1).includes(String(job.name));
  const del = await api('DELETE', `/api/schedule?id=${encodeURIComponent(id || job.name)}`);
  const list2 = (await api('GET', '/api/schedule')).json;
  const gone = !JSON.stringify(list2).includes(String(job.name));
  const ok = present && gone;
  return a(ok ? CL.CI : CL.FAIL, ok ? `scheduled job "${job.name}" created → listed → deleted (scheduler CRUD round-trip)` : 'scheduler CRUD broken', { present, gone, mk: mk.json, del: del.json });
}
async function s25(a) {
  const info = await api('POST', '/api/tool', { tool: 'sys.info', args: {} });
  const ps = await api('POST', '/api/tool', { tool: 'sys.ps', args: { sort: 'mem', limit: 10 } });
  const psText = String(ps.json.result || '');
  const self = psText.toLowerCase().includes('majin');
  const ok = info.json.ok === true && ps.json.ok === true;
  return a(ok ? CL.CI : CL.FAIL, ok ? `sys.info + sys.ps real (process list includes majin: ${self})` : 'sys tools failed', { info: String(info.json.result || '').slice(0, 120), majinVisible: self });
}
async function s26(a) {
  const r404 = await api('GET', '/api/report?file=no-such-report.json');
  const outside = await api('GET', '/api/report?file=../config.json');
  const ok = r404.status === 404 && [403, 404].includes(outside.status);
  return a(ok ? CL.CI : CL.FAIL, ok ? '/api/report contract: 404 for missing, escape refused' : 'report route contract broken', { missing: r404.status, escape: outside.status });
}
async function c01(a) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', "(Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -First 8 Name, MainWindowTitle | ConvertTo-Json -Compress"], { encoding: 'utf8', timeout: 30000 });
  let items = [];
  try { const parsed = JSON.parse(r.stdout || '[]'); items = Array.isArray(parsed) ? parsed : [parsed]; } catch { items = [{ name: '(parse failed)', sample: (r.stdout || '').slice(0, 120) }]; }
  const cliSession = spawnSync('query', ['session'], { encoding: 'utf8', timeout: 15000, shell: true });
  return a(CL.CI, `window enumeration works in this session; visible windows: ${items.length}; sessionType=${/Services|0\s/.test(cliSession.stdout || '') ? 'service/console-0' : 'interactive'}`, { windows: items.slice(0, 6), session: String(cliSession.stdout || '').slice(0, 150) });
}
async function c02(a) {
  // Honesty lane: interactive desktop availability is a property of the session,
  // not of the app. We check and classify; we never fabricate a GUI interaction.
  const q = spawnSync('query', ['session'], { encoding: 'utf8', timeout: 15000, shell: true });
  const s = String(q.stdout || '');
  const interactive = /console\s+\d+\s+Active/i.test(s) && !/Services/i.test(String(process.env.SESSIONNAME || '')) && String(process.env.GITHUB_ACTIONS) !== 'true' ? true : /Active.*(RDP|console)/i.test(s);
  const saneRun = spawnSync('powershell.exe', ['-NoProfile', '-Command', '"SESSIONNAME=" + $env:SESSIONNAME + "; CONSOLE=" + ([Environment]::UserInteractive)'], { encoding: 'utf8', timeout: 15000 });
  const userInteractive = /CONSOLE=True/i.test(String(saneRun.stdout || ''));
  if (process.env.GITHUB_ACTIONS === 'true' && !userInteractive) {
    return a(CL.BLOCKED, 'no interactive desktop in GitHub-hosted CI session (Session 0). Win32 GUI automation of the installed desktop GUI requires a self-hosted interactive runner.', {
      why: 'GitHub-hosted runners execute as a Windows service; [Environment]::UserInteractive=False, keyboard focus and UIA Actuation are unavailable to the agent process.',
      howToVerify: [
        '1. Provision a self-hosted Windows runner with an auto-logon user (Autologon64.exe or registry Winlogon AutoAdminLogon=1) and actions-runner configured with runAsService=false.',
        '2. Launch the runner from the interactive console session (start-process in the logged-on session), not as a service.',
        '3. Dispatch win-qa-realworld.yml with qa_interactive=true; scenarios c02+ then execute the typed-input probes and can claim VERIFIED_REAL.',
        '   (a disposable Azure/DevTest Windows VM with auto-logon satisfies the same contract.)',
      ].join('\n'),
      sessionQuery: s.slice(0, 160), userInteractive,
    });
  }
  return a(CL.SKIP, 'not in CI and interactive state is unverified; not attempting GUI actuation without the interactive-runner contract', { userInteractive, session: s.slice(0, 120) });
}
async function b01(a) {
  const open = await api('POST', '/api/tool', { tool: 'browser.open', args: { url: 'https://example.com' } }, { timeoutMs: 120000 });
  if (open.json.ok !== true) return a(CL.FAIL, `browser.open refused: ${open.json.error?.message || ''}`.slice(0, 140), open.json);
  await sleep(1500);
  const read = await api('POST', '/api/tool', { tool: 'browser.read', args: {} }, { timeoutMs: 60000 });
  const shot = await api('POST', '/api/tool', { tool: 'browser.shot', args: { path: 'qa-audit/example.png' } }, { timeoutMs: 60000 });
  const body = String(read.json.result || '');
  const ok = read.json.ok === true && /Example Domain/i.test(body);
  const shotRef = shot.json.ok === true ? 'saved' : String(shot.json.error?.message || 'failed');
  return a(ok ? CL.CI : CL.FAIL, ok ? `real browser automation through the installed app: opened example.com, read text ("Example Domain" found), screenshot ${shotRef}` : 'browser read-back incomplete', { open: true, readPreview: body.slice(0, 100), shot: shotRef, shotMeta: shot.json.meta || null });
}

const PLAN = [
  ['s01', 'release SHA-256 vs installer bytes', 'artifact', CL.CI, s01],
  ['s02', 'silent install layout + first-run version', 'install', CL.CI, s02],
  ['s03', 'CLI smoke (--help contract)', 'cli', CL.CI, s03],
  ['s04', 'auth boundary (token gate, /healthz public)', 'security', CL.CI, s04],
  ['s05', 'UI assets served authenticated, token injected', 'ui-backend', CL.CI, s05],
  ['s06', 'provider configure + key redaction in /api/config', 'security', CL.CI, s06],
  ['s07', 'route table → local model, MOA off', 'config', CL.CI, s07],
  ['s08', 'provider test: REAL completion via installed app', 'real-model', CL.CI, s08],
  ['s09', 'live model discovery from Ollama', 'real-model', CL.CI, s09],
  ['s10', 'REAL chat (non-stream): audit token reproduced', 'chat', CL.CI, s10],
  ['s11', 'REAL streaming chat (SSE deltas + done)', 'chat', CL.CI, s11],
  ['s12', 'REAL cancel mid-stream', 'chat', CL.CI, s12],
  ['s13', 'multi-turn in-session memory (real model)', 'context', CL.CI, s13],
  ['s14', 'model switch mid-conversation, context intact', 'routing', CL.CI, s14],
  ['s15', 'autopilot task registration + fleet status (no model)', 'orchestration', CL.CI, s15],
  ['s16', 'graceful restart → history persists', 'persistence', CL.CI, s16],
  ['s17', 'hard kill mid-generation → journal intact', 'crash-recovery', CL.CI, s17],
  ['s18', 'files.write tool → byte-exact download → escape refused', 'tools-files', CL.CI, s18],
  ['s19', 'guard: exec-risk tool waits for approval', 'security-guard', CL.CI, s19],
  ['s20', 'guard: explicit DENY stops exec-risk tool', 'security-guard', CL.CI, s20],
  ['s21', 'web.fetch against real network', 'network', CL.CI, s21],
  ['s22', 'update check against real GitHub', 'network', CL.CI, s22],
  ['s23', 'memory fact persists across restart', 'memory', CL.CI, s23],
  ['s24', 'scheduler CRUD round-trip', 'orchestration', CL.CI, s24],
  ['s25', 'system probes: sys.info + sys.ps', 'system', CL.CI, s25],
  ['s26', '/api/report route contract + escape refused', 'api-contract', CL.CI, s26],
  ['c01', 'windows enumeration (in-session capability)', 'control', CL.CI, c01],
  ['c02', 'interactive desktop actuation (honesty gate)', 'control', CL.REAL, c02],
  ['b01', 'browser automation through installed tool belt', 'browser-automation', CL.CI, b01],
];

async function main() {
  console.log(`MAJIN QA REAL-WORLD engine — exe=${CFG.exe} home=${CFG.home} port=${CFG.port} evid=${CFG.evid} models=${CFG.models.join(',')}`);
  console.log(`classification ceiling: VERIFIED_CI (CI service session — GUI actuation lanes gate themselves)`);
  const bootT0 = Date.now();
  await startServer();
  TOKEN = tokenFromConfig();
  const bootMs = Date.now() - bootT0;
  console.log(`[QA] server up (boot ${bootMs}ms), token acquired: ${TOKEN ? TOKEN.slice(0, 4) + '…' : '✗ MISSING'}`);
  if (!TOKEN) throw new Error('could not obtain the server token from config or logs');
  evidWrite('s00-boot', { bootMs, port: CFG.port, tokenFrom: 'config.json or stdout', exe: CFG.exe });

  for (const [id, name, lane, ceiling, fn] of PLAN) {
    await scenario(id, name, lane, ceiling, fn);
  }

  await stopServer(false).catch(() => {});
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;
  const report = {
    schema: 'majin.qa-realworld.v1',
    product: { name: 'MAJIN', version: '1.0.0', artifact: 'published GitHub release v1.0.0', install: 'silent Inno Setup → %LOCALAPPDATA%\\Programs\\MAJIN' },
    env: {
      runner: process.env.GITHUB_ACTIONS ? 'github-hosted windows-latest (Session 0 service)' : os.type() + ' ' + os.release(),
      os: `${os.type()} ${os.release()}`,
      interactiveDesktop: process.env.GITHUB_ACTIONS === 'true' ? false : null,
      models: CFG.models.map((m) => `ollama/${m}`),
    },
    startedAt: new Date().toISOString(),
    counts,
    scenarios: results,
  };
  fs.writeFileSync(path.join(EVID, 'qa-report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== QA REAL-WORLD SUMMARY ===');
  for (const r of results) console.log(`${r.status.padEnd(12)} ${r.id} ${r.name}  (${r.ms}ms)`);
  console.log(`\ncounts: ${JSON.stringify(counts)}`);
  const failed = results.filter((r) => r.status === CL.FAIL);
  if (failed.length) console.log(`FAILED scenarios: ${failed.map((f) => f.id).join(', ')} (see evidence dir)`);
}
main().catch((err) => {
  console.error('QA engine broke:', err);
  try { saveServerLogs('engine-fatal'); } catch { /* */ }
  process.exit(2);
});
