#!/usr/bin/env node
/**
 * MAJIN — kommandorad.
 *   majin                start the server and open the window
 *   majin start|window   samma, explicit
 *   majin doctor [--full]   check everything that has to work
 *   majin status|url|logs    see what is running
 *   majin config get|set     redigera utan UI
 *   majin pair telegram|whatsapp
 *   majin send "text"        one question, answer on stdout
 *   majin re <fil> [--json]  RE-analys direkt i terminalen
 *   majin test               testsvit
 *   majin version
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load } from '../core/config.js';
import { dirs, ensureDirs, expand } from '../core/paths.js';
import { bus } from '../core/log.js';
import { VERSION, createRuntime } from '../core/runtime.js';

const SELF_DIR = (() => {
  try {
    if (typeof __dirname !== 'undefined') return __dirname;
  } catch {
    /* bundlad CJS */
  }
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const argv = process.argv.slice(2);
const cmd = (argv[0] && !argv[0].startsWith('-') ? argv.shift() : 'start').toLowerCase();
const flags = parseFlags(argv);
const json = () => flags.json;

main().catch((err) => {
  process.stderr.write(`majin: ${err.message}\n${err.hint ? `  → ${err.hint}\n` : ''}`);
  process.exit(1);
});

async function main() {
  ensureDirs();
  switch (cmd) {
    case 'start':
    case 'serve':
      return start();
    case '_serve':
      return serve();
    case 'window':
    case 'ui':
    case 'app':
      return window_();
    case 'doctor':
    case 'check':
      return doctor();
    case 'status':
      return status();
    case 'url':
      return url_();
    case 'token':
      return process.stdout.write(load().get('server.token') + '\n');
    case 'logs':
      return logs();
    case 'config':
      return config();
    case 'pair':
      return pair();
    case 'send':
    case 'ask':
      return send();
    case 're':
    case 'analyze':
      return re();
    case 'test':
      return test();
    case 'version':
    case '--version':
    case '-v':
      return process.stdout.write(`majin ${VERSION} · node ${process.version} · ${process.platform}\n`);
    case 'help':
    case '--help':
    case '-h':
      return help();
    default:
      process.stderr.write(`unknown command "${cmd}" \u2014 run: majin help\n`);
      process.exit(2);
  }
}

/* ------------------------------- server -------------------------------- */

async function start() {
  const cfg = load();
  const port = Number(flags.port) || cfg.get('server.port');
  const alive = await ping(port);
  if (alive) {
    process.stdout.write(`MAJIN already runs on :${port} — ${alive.url}\n`);
    if (flags.window !== false) openWindow(alive.url);
    return;
  }
  const self = (() => {
    if (process.pkg) return process.execPath; // bundlad exe: kör sig själv med _serve
    for (const ext of ['.js', '.cjs', '.mjs']) {
      const cand = path.join(SELF_DIR, `majin${ext}`);
      if (fs.existsSync(cand)) return cand;
    }
    return process.argv[1];
  })();
  const child = spawn(process.execPath === self ? self : process.execPath, [self, '_serve', ...(flags.json ? ['--json'] : []), ...(flags.port ? [`--port=${flags.port}`] : []), ...(flags.noChannels || flags.channels === false ? ['--no-channels'] : [])], {
    stdio: 'inherit',
    env: { ...process.env, MAJIN_PORT: String(port) },
  });
  child.on('exit', (code, sig) => {
    if (code === 75) {
      process.stdout.write('MAJIN restarting…\n');
      setTimeout(() => start(), 350);
      return;
    }
    if (code && code !== 0) process.stdout.write(`MAJIN exited (${code}${sig ? ' ' + sig : ''})\n`);
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  if (!flags.noWindow && flags.window !== false) setTimeout(() => openWindow(`http://127.0.0.1:${port}/?t=${cfg.get('server.token')}`), 900);
  return new Promise((r) => child.on('exit', r));
}

async function serve() {
  const rt = await createRuntime({ channels: flags.channels !== false, scheduler: true });
  if (flags.port) rt.cfg.patch({ server: { port: Number(flags.port) } });
  const { createServer } = await import('../core/server/index.js');
  const server = createServer(rt);
  const port = Number(process.env.MAJIN_PORT || rt.cfg.get('server.port') || 8787);
  const host = rt.cfg.get('server.host') || '0.0.0.0';
  await new Promise((resolve) => server.listen(port, host, resolve));
  const url = `http://127.0.0.1:${port}/?t=${rt.cfg.get('server.token')}`;
  process.stdout.write([
    `MAJIN ${VERSION} listening on http://${host}:${port}`,
    `  konfigur   ${rt.cfg.file}`,
    `  workspace  ${rt.cfg.get('workspace')}`,
    `  tools      ${rt.registry.list().length} (all on, always)`,
    `  MOA        ${rt.cfg.get('moa.policy')} · width ${rt.cfg.get('moa.width')} → ${String(rt.cfg.get('moa.aggregator') || '').split('/').pop()}`,
    `  provider   ${rt.cfg.get('models.provider')} (${rt.cfg.providerStatus().filter((p) => p.ready).map((p) => p.name).join(', ') || 'no key — demo'})`,
    `  channels   telegram ${rt.cfg.get('channels.telegram.botToken') ? 'token ok' : 'no token'} · whatsapp ${rt.cfg.get('channels.whatsapp.transport')}`,
    `  open       ${url}`,
    '',
  ].join('\n'));
  if (rt.cfg.get('server.openBrowser') !== false && !flags.noWindow) openWindow(url);
  const bye = async (sig) => {
    process.stdout.write(`\nshutting down (${sig})\n`);
    try {
      server.close();
      await rt.shutdown();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => bye('SIGINT'));
  process.on('SIGTERM', () => bye('SIGTERM'));
  process.on('unhandledRejection', (e) => bus.warn('unhandled', { error: e?.message || String(e) }));
  setInterval(() => {}, 1 << 30);
}

function openWindow(url) {
  const win = process.platform === 'win32';
  const cands = win
    ? [
        process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
        process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe') : null,
        process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe') : null,
      ].filter(Boolean)
    : ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'];
  const bin = cands.find((c) => {
    try {
      return fs.existsSync(c);
    } catch {
      return false;
    }
  });
  if (!bin) {
    if (win) {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      return `opened in your default browser: ${url}`;
    }
    process.stdout.write(`no Edge/Chrome found — open ${url} yourself\n`);
    return null;
  }
  const child = spawn(bin, [`--app=${url}`, '--window-size=1240,820', '--window-position=90,70', '--no-first-run', '--disable-filters'], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => process.stderr.write(`window: ${e.message}\n`));
  child.unref();
  return url;
}

async function window_() {
  const cfg = load();
  const port = Number(flags.port) || cfg.get('server.port');
  const alive = await ping(port);
  const url = (alive?.url || `http://127.0.0.1:${port}/?t=${cfg.get('server.token')}`) + (alive ? `?t=${cfg.get('server.token')}` : '');
  if (!alive) {
    process.stdout.write('server not running — starting it…\n');
    await start();
    return;
  }
  process.stdout.write((openWindow(url) || url) + '\n');
}

/* ------------------------------- diagnose ------------------------------- */

async function doctor() {
  const rt = await createRuntime({ channels: false, scheduler: false });
  const lines = [];
  const put = (ok, label, detail = '') => lines.push(`${ok ? '✔' : '✖'} ${label.padEnd(26)}${detail}`);
  const st = rt.state({ includeTools: false });
  put(true, 'config', st.configFile);
  put(Boolean(rt.cfg.get('workspace')), 'workspace', rt.cfg.get('workspace'));
  try {
    fs.accessSync(rt.cfg.get('workspace'), fs.constants.W_OK);
    put(true, 'writable', 'yes');
  } catch {
    put(false, 'writable', 'NO — pick another workspace');
  }
  const ready = st.providers.filter((p) => p.ready);
  put(ready.length > 0, 'providers', ready.length ? ready.map((p) => `${p.name}(${p.models.length})`).join(' ') : 'no key — demo mode');
  put(st.routes.filter((r) => r.ready).length > 0 || rt.cfg.needsSetup, 'routes', `ready ${st.routes.filter((r) => r.ready).length}/${st.routes.length}${rt.cfg.needsSetup ? ' (no key yet)' : ''}`);
  put(st.moa.policy !== 'off', 'MOA', `${st.moa.policy} · width ${st.moa.width} → ${String(st.moa.aggregator).split('/').pop()}`);
  put(rt.registry.list().length > 60, 'tools', `${rt.registry.list().length} registered, none disabled`);
  put(st.guard.mode !== undefined, 'guard', `${st.guard.mode} · ${st.guard.pending} waiting`);
  const { detect } = await import('../core/binary/external.js');
  const ext = detect();
  put(true, 'RE external', Object.entries(ext).filter(([, v]) => v).length ? Object.entries(ext).filter(([, v]) => v).map(([k]) => k).join(' ') : 'built-in parsers only (ghidra/rizin optional)');
  put(fs.existsSync(path.join(dirs.rules, 'majin.yar')), 'RE rules', dirs.rules);
  const port = Number(rt.cfg.get('server.port'));
  const taken = await ping(port);
  put(true, 'port', taken ? `${port} taken by MAJIN (just run: majin window)` : `${port} free`);
  if (flags.full) {
    process.stdout.write('running self-test (network + model calls)…\n');
    const out = await rt.registry.exec('majin.selftest', { level: 'full' }, { ...rt.ctx, session: 'doctor', step: 1 });
    lines.push(String(out.result || out.error?.message || '').replace(/^/gm, '   '));
  }
  await rt.shutdown();
  process.stdout.write(lines.join('\n') + '\n');
  const bad = lines.filter((l) => l.startsWith('✖')).length;
  if (bad) process.stdout.write(`\n${bad} issue(s) need attention.\n`);
  process.exitCode = bad ? 1 : 0;
}

async function status() {
  const port = Number(flags.port) || load().get('server.port');
  const alive = await ping(port);
  if (!alive) {
    process.stdout.write('MAJIN is not running on :' + port + '\n  start it: majin\n');
    process.exitCode = 1;
    return;
  }
  const st = await get(port, '/api/state?tools=0&t=' + alive.token);
  process.stdout.write(
    [
      `MAJIN ${st.version} · up ${Math.round(st.up / 60)} min · pid ${st.pid}`,
      `  provider ${st.providers.filter((p) => p.ready).map((p) => p.name).join(', ') || 'demo'} · routes ${st.routes.length}`,
      `  MOA ${st.moa.policy} (${st.moa.width}) · guard ${st.guard.mode}${st.guard.pending ? ` (${st.guard.pending} waiting)` : ''}`,
      `  tools ${st.tools.count} · memory ${st.memory?.facts ?? 0} facts · skills ${(st.skills || []).length}`,
      `  telegram ${st.channels.telegram.state} · whatsapp ${st.channels.whatsapp.state}`,
      `  cost ${Number(st.usage.costUsd || 0).toFixed(4)} USD / ${st.usage.requests} calls${st.usage.budgetUsd ? ` of ${st.usage.budgetUsd}` : ''}`,
      `  schedule ${(st.schedule || []).length} jobs`,
      `  url     ${alive.url}`,
    ].join('\n') + '\n',
  );
}

async function logs() {
  const port = Number(flags.port) || load().get('server.port');
  const alive = await ping(port);
  if (!alive) return process.stdout.write('server is not running\n');
  const n = Number(flags.n || 40);
  const r = await get(port, `/api/logs?n=${n}&t=${alive.token}`);
  process.stdout.write((r.events || []).map(formatEvent).join('\n') + '\n');
}

async function config() {
  const cfg = load();
  const sub = argv.shift();
  if (sub === 'path') return process.stdout.write(cfg.file + '\n');
  if (sub === 'get') {
    const key = argv.shift();
    const v = key ? cfg.get(key) : cfg.redacted();
    return process.stdout.write((typeof v === 'string' ? v : JSON.stringify(v, null, 2)) + '\n');
  }
  if (sub === 'set') {
    const key = argv.shift();
    const raw = argv.join(' ');
    if (!key || !raw) return process.stderr.write('config set <key> <value>\n');
    let value = raw;
    if (/^(true|false|null)$/.test(raw)) value = raw === 'true' ? true : raw === 'false' ? false : null;
    else if (!Number.isNaN(Number(raw)) && raw !== '') value = Number(raw);
    else if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        value = JSON.parse(raw);
      } catch (e) {
        return process.stderr.write('JSON error: ' + e.message + '\n');
      }
    }
    const { setPath } = await import('../core/config.js');
    const next = cfg.json();
    setPath(next, key, value);
    const r = cfg.patch(topFromPath(key, value), { source: 'cli' });
    if (!r.ok) return process.stderr.write('rejected: ' + r.errors.map((e) => `${e.path}: ${e.msg}`).join('; ') + '\n');
    process.stdout.write(`saved ${key} = ${JSON.stringify(value)}\n  in ${cfg.file}\n`);
    return;
  }
  if (sub === 'open') {
    return openWindow('file://' + cfg.file.replace(/\\/g, '/')) || process.stdout.write(cfg.file + '\n');
  }
  process.stdout.write(JSON.stringify(cfg.redacted(), null, 2) + '\n');
}

function formatEvent(e) {
  const { id, ts, type, level, msg, ...rest } = e;
  void id;
  const tail = Object.entries(rest).slice(0, 4).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60)}`).join(' ');
  return `${String(ts || '').slice(11, 19)} ${String(type).padEnd(22)}${level && level !== 'info' ? level + ' ' : ''}${msg ? msg + ' ' : ''}${tail}`;
}

function topFromPath(key, value) {
  const parts = key.split('.');
  let node = value;
  for (let i = parts.length - 1; i > 0; i -= 1) node = { [parts[i]]: node };
  return { [parts[0]]: node };
}

async function pair() {
  const what = (argv.shift() || 'telegram').toLowerCase();
  const cfg = load();
  const port = Number(flags.port) || cfg.get('server.port');
  const alive = await ping(port);
  if (!alive) {
    process.stdout.write('start MAJIN first (run: majin), then run majin pair again\n');
    process.exitCode = 1;
    return;
  }
  if (what.startsWith('t')) {
    const r = await post(port, '/api/channels/telegram', alive.token, {});
    process.stdout.write([`telegram: ${r.ok ? 'running' : 'failed'} · state ${r.status?.state}`, r.pairingCode ? `  pairing code ${r.pairingCode} — send "/pair ${r.pairingCode}" to your bot` : '', r.status?.lastError ? `  error: ${r.status.lastError}` : ''].filter(Boolean).join('\n') + '\n');
    return;
  }
  const r = await post(port, '/api/channels/whatsapp', alive.token, {});
  process.stdout.write([`whatsapp: state ${r.status?.state} (${r.status?.transport})`, r.status?.qr ? '  the QR code is in the UI (panel → Channels)' : '', r.status?.lastError ? `  ${r.status.lastError}` : '', r.status?.hint ? `  ${r.status.hint}` : ''].filter(Boolean).join('\n') + '\n');
}

async function send() {
  const text = argv.join(' ').trim();
  if (!text) return process.stderr.write('majin send "what you want"\n');
  const cfg = load();
  const port = Number(flags.port) || cfg.get('server.port');
  const alive = await ping(port);
  if (!alive) {
    process.stdout.write('server is not running — running inline: ');
    const rt = await createRuntime({ channels: false, scheduler: false });
    const r = await rt.agent.turn({ input: text, session: flags.session || 'cli', source: 'cli', onEvent: (e) => process.stderr.write(`· ${e.type}${e.tool ? ' ' + e.tool : ''}\n`) });
    process.stdout.write(r.text + '\n');
    await rt.shutdown();
    return;
  }
  if (flags.raw) {
    const r = await post(port, '/api/chat', alive.token, { input: text, session: flags.session || 'cli' });
    return process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  }
  const res = await fetch(`http://127.0.0.1:${port}/api/chat?t=${alive.token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + alive.token },
    body: JSON.stringify({ input: text, session: flags.session || 'cli' }),
  });
  if (!res.body) return;
  const dec = new TextDecoder();
  let buf = '';
  let answer = '';
  while (true) {
    const { value, done } = await res.body.getReader();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const dl = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!dl) continue;
      try {
        const ev = JSON.parse(dl.slice(6));
        if (ev.type === 'delta') process.stdout.write(ev.text);
        else if (ev.type === 'answer') answer = ev.text;
        else if (ev.type === 'error') process.stderr.write(`\nerror: ${ev.message}\n`);
        else if (['tool', 'tool_result', 'route', 'escalate', 'config'].includes(ev.type)) process.stderr.write(`· ${ev.type}${ev.tool || ev.name ? ' ' + (ev.tool || ev.name) : ''}${ev.job ? ' [' + ev.job + ']' : ''}\n`);
      } catch {
        /* */
      }
    }
  }
  if (answer) process.stdout.write('\n');
}

async function re() {
  const target = argv.shift();
  if (!target) return process.stderr.write('majin re <fil> [--json]\n');
  const abs = path.resolve(expand(target));
  if (!fs.existsSync(abs)) return process.stderr.write(`cannot find ${abs}\n`);
  const rt = await createRuntime({ channels: false, scheduler: false });
  const out = await rt.registry.exec('re.analyze', { path: abs }, { ...rt.ctx, session: 'cli', step: 1 });
  await rt.shutdown();
  if (json()) return process.stdout.write(JSON.stringify(out.meta || out, null, 2) + '\n');
  if (!out.ok) return process.stderr.write((out.error?.message || 'failed') + '\n');
  process.stdout.write(String(out.result) + '\n');
}

async function test() {
  const dir = path.resolve(SELF_DIR, '../../test');
  if (!fs.existsSync(dir)) return process.stderr.write('ingen test-mapp\n');
  const child = spawn(process.execPath, ['--test', ...(flags.experimental ? [flags.experimental] : []), dir], { stdio: 'inherit' });
  await new Promise((r) => child.on('exit', r));
  process.exitCode = child.exitCode || 0;
}

function help() {
  process.stdout.write(
    [
      `MAJIN ${VERSION} — an autonomous agent that owns its own keys.`,
      '',
      '  majin                      start the server and open the window',
      '  majin start [--no-window]  run without a window',
      '  majin window               open another window on the running server',
      '  majin doctor [--full]      providers, keys, tools, RE, port, workspace',
      '  majin status | url | logs  show what is running',
      '  majin config [get <key> | set <key> <value> | path]',
      '  majin pair telegram|whatsapp   connect a chat',
      '  majin send "text"            one question through the agent',
      '  majin re <file> [--json]     RE analysis (PE/ELF/APK/PCAP), no server',
      '  majin test                 run the test suite',
      '',
      `config: ${dirs.config}   workspace: ${dirs.workspace}   data: ${dirs.root}`,
      'Every tool is always on. Mixture-of-Agents runs by default — nothing to enable.',
    ].join('\n') + '\n',
  );
}

/* -------------------------------- http ---------------------------------- */

function ping(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/healthz', timeout: 900 }, (res) => {
      let b = '';
      res.on('data', (c) => {
        b += c;
      });
      res.on('end', () => {
        try {
          const j = JSON.parse(b);
          resolve(j.ok ? { url: `http://127.0.0.1:${port}`, port, token: token() } : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

function token() {
  try {
    return load().get('server.token');
  } catch {
    return '';
  }
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: p, timeout: 4000 }, (res) => {
      let b = '';
      res.on('data', (c) => {
        b += c;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(b));
        } catch {
          reject(new Error('svar kunde inte tolkas: ' + b.slice(0, 120)));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function post(port, p, tk, obj) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(obj || {});
    const req = http.request(
      { host: '127.0.0.1', port, path: p + (p.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(tk), method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), authorization: 'Bearer ' + tk }, timeout: 120000 },
      (res) => {
        let b = '';
        res.on('data', (c) => {
          b += c;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(b));
          } catch {
            resolve({ ok: res.statusCode < 400, raw: b.slice(0, 400) });
          }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.end(body);
  });
}

function url_() {
  const cfg = load();
  const host = cfg.get('server.host');
  const shown = host === '0.0.0.0' ? '127.0.0.1' : host;
  process.stdout.write(`http://${shown}:${cfg.get('server.port')}/?t=${cfg.get('server.token')}\n`);
}

function valueFlags() {
  return new Set([
  'port', 'host', 'token', 'home', 'config', 'file', 'out', 'wait', 'waitMs', 'name', 'model', 'llm', 'session',
  'provider', 'key', 'target', 'path', 'exe', 'task', 'level', 'glob', 'rules', 'code', 'url', 'seconds',
  'ms', 'size', 'command', 'args', 'channel', 'to', 'id', 'limit', 'format', 'encoding', 'offset',
  ]);
}

function parseFlags(list) {
  const VALUE_FLAGS = valueFlags();
  const out = {};
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (!a.startsWith('-')) {
      (out._ ||= []).push(a);
      continue;
    }
    const m = /^--?([\w-]+)(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const key = m[1].replace(/-([a-z])/g, (_x, c) => c.toUpperCase());
    if (m[2] !== undefined) {
      out[key] = m[2] === 'false' ? false : m[2];
      continue;
    }
    // `--port 8931` ska fungera som `--port=8931`; okända flaggor förblir booleska
    const next = list[i + 1];
    if (VALUE_FLAGS.has(key) && next !== undefined && !next.startsWith('-')) {
      out[key] = next === 'false' ? false : next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}
