/** MAJIN — real browser-use over the Chrome DevTools Protocol.
 *
 * Design contract (DECISIONS.md): we control the browser the user already
 * HAS (Edge ships with every Windows, Chrome elsewhere) instead of shipping
 * a bundled rendering engine or a Python framework. Node ≥ 22's built-in
 * fetch + WebSocket are enough to speak CDP; everything WebSocket-shaped
 * in this module is lazily created at first real use so the module loads on
 * older runtimes too — a browser action on such a runtime gets a human
 * sentence, not a crash.
 *
 * AUTOPILOT rules baked in (master brief):
 *   - Every agent session owns its OWN browser instance with its OWN
 *     profile directory — two agents can never click in each other's tabs
 *     (test G), because they never share a surface.
 *   - Concurrent instances are capped (config browser.maxInstances, the
 *     slots are process-wide and locked); a fourth session queues instead
 *     of spawning a splash of windows.
 *   - Loop guard: the same action signature three times in a row with the
 *     same outcome = we are stuck; the tool throws an honest error rather
 *     than clicking itself into seventy identical failures.
 *   - Evidence before confidence: every action tool answers with the page's
 *     own words (element text, value that stuck, URL the click produced),
 *     never a bare "done".
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dirs } from './paths.js';
import { fileLocks } from './tasks.js';

/* ------------------------------ loop guard ------------------------------ */

export class LoopJournal {
  constructor({ window = 8 } = {}) {
    this.window = window;
    this.bySession = new Map();
  }

  /** A signature is (tool, target, args). Throws LoopStuckError after three
      identical consecutive actions with the same outcome — deterministic,
      zero-LLM stuck-loop detection. */
  guard(session, signature, outcome = '') {
    const k = String(session || 'default');
    const list = this.bySession.get(k) || [];
    const last3 = list.slice(-2);
    if (last3.length === 2 && last3.every((e) => e.sig === signature && e.outcome === outcome)) {
      throw new Error(
        `browser loop detected: "${signature}" already ran 3 times in a row with the same result — change the approach (new selector, new step, or ask the user) instead of clicking it a fourth time`,
      );
    }
    list.push({ sig: signature, outcome, at: Date.now() });
    if (list.length > this.window) list.splice(0, list.length - this.window);
    this.bySession.set(k, list);
  }

  acts(session) {
    return [...(this.bySession.get(String(session || 'default')) || [])];
  }
}

export const journal = new LoopJournal();

/* --------------------------- browser discovery --------------------------- */

/** Candidate executables per platform, in sanity order. Kept as data so a
    test can read the table without touching the filesystem. */
export function browserCandidates(platform = process.platform, env = process.env) {
  if (platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pfx = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env.LOCALAPPDATA || 'C:\\Users\\user\\AppData\\Local';
    return [
      `${pfx}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pfx}\\Google\\Chrome\\Application\\chrome.exe`,
      `${local}\\Google\\Chrome\\Application\\chrome.exe`,
    ];
  }
  if (platform === 'darwin') {
    return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/usr/bin/chromium'];
  }
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge'];
}

export function findBrowser(candidates = browserCandidates()) {
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return null;
}

/* ------------------------------ slot pool -------------------------------- */

/** maxInstances concurrent browsers, process-wide. Slots are fileLocks on
    `browser:slot:N` — a waiting agent waits for a SLOT to free, never for
    every other task (same semantics as file conflicts). */
export function createBrowserPool({ locks = fileLocks, max = 3 } = {}) {
  const held = new Map(); // session → { slot, release }
  return {
    async claim(session, { timeoutMs = 0 } = {}) {
      const k = String(session || 'default');
      if (held.has(k)) return held.get(k).slot;
      for (let n = 1; n <= max; n += 1) {
        try {
          const release = await locks.acquire(`browser:slot:${n}`, k, { timeoutMs });
          const rec = { slot: n, release };
          held.set(k, rec);
          return n;
        } catch {
          /* slot busy — try the next */
        }
      }
      throw new Error(`all ${max} browser instances are busy — finish or close one of the running browser tasks and try again`);
    },
    release(session) {
      const rec = held.get(String(session || 'default'));
      if (rec) {
        rec.release();
        held.delete(String(session || 'default'));
      }
      return Boolean(rec);
    },
    slotOf(session) {
      return held.get(String(session || 'default'))?.slot || null;
    },
    count: () => held.size,
    max: () => max,
  };
}

/* ------------------------------ CDP client ------------------------------- */

const RPC_TIMEOUT_MS = 20000;

async function wsConnect(wsUrl, factory) {
  const make = factory || ((u) => new globalThis.WebSocket(u));
  if (typeof make !== 'function' || (factory == null && typeof globalThis.WebSocket !== 'function')) {
    throw new Error('this runtime has no built-in WebSocket (needs node ≥22 — the packaged MAJIN exe already has one)');
  }
  const ws = make(wsUrl);
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('browser debug port never answered (10 s)')), 10000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('could not open the browser debug connection'));
    };
  });
  return ws;
}

function cdpRpc(ws) {
  let id = 0;
  const waiting = new Map();
  ws.onmessage = (msg) => {
    let ev;
    try {
      ev = JSON.parse(typeof msg.data === 'string' ? msg.data : String(msg.data));
    } catch {
      return;
    }
    const w = waiting.get(ev.id);
    if (w) {
      waiting.delete(ev.id);
      if (ev.error) w.reject(new Error(ev.error.message || 'CDP error'));
      else w.resolve(ev.result || {});
    }
  };
  return (method, params = {}, { timeoutMs = RPC_TIMEOUT_MS, sessionId = null } = {}) => {
    id += 1;
    ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        waiting.delete(id);
        reject(new Error(`CDP timeout after ${timeoutMs}ms on ${method}`));
      }, timeoutMs);
      waiting.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
    });
  };
}

/* --------------------------- browser session ----------------------------- */

const sess = new Map(); // sessionId (agent session) → live browser, own window + own profile

function profileFor(session) {
  return path.join(dirs.cache, 'browser-' + String(session).replace(/[^\w.-]/g, '_'));
}

async function httpJson(url, { timeoutMs = 5000 } = {}) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}



/** Launch (or reuse) the browser for ONE agent session and navigate it. */
export async function openFor({ session, url = null, headless = true, cfgGet = null, pool = null, exe = null, wsFactory = null } = {}) {
  session = String(session || 'default');
  const existing = sess.get(session);
  if (existing) {
    /* reuse = obtain the handle, NOT navigate. Ever since f022c04 this
       defaulted to 'about:blank' and raced the user's page away — tool
       chaining (open → read → fill → click) lived or died on eval-vs-navigate
       luck. Pinned by test: no goto here without an explicit url. */
    if (url && url !== 'about:blank') await existing.goto(url);
    return existing;
  }
  const thePool = pool || createBrowserPool({ max: Number(cfgGet?.('browser.maxInstances')) || 3 });
  const slot = await thePool.claim(session);
  const bin = exe || findBrowser();
  if (!bin) {
    thePool.release(session);
    throw new Error('found no Chrome or Edge on this machine — install one of them and MAJIN can drive it');
  }
  const profile = profileFor(`${session}-s${slot}`);
  fs.mkdirSync(profile, { recursive: true });
  let proc = null;
  let version = null;
  let lastErr = null;
  /* Del 5ABE flake-hardening (CI evidence: runs 39261715303 + 39265517682):
     the Windows runner's policy gate sometimes swallows the FIRST spawned
     Edge for ~10 s — one shot of luck was the difference between green and a
     red suite. Bounded retry: attempt 1 as before, attempt 2 with a fresh
     random port + longer deadline. Honest: the final error text is unchanged. */
  for (let attempt = 1; attempt <= 2 && !version; attempt++) {
    if (proc && !proc.killed) { try { proc.kill(); } catch { /* gone */ } }
    const port = randomPort();
    const args = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking',
    ];
    if (headless !== false) args.push('--headless=new');
    args.push('about:blank');
    proc = spawn(bin, args, { detached: false, stdio: 'ignore' });
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + (attempt === 1 ? 10000 : 15000);
    while (Date.now() < deadline) {
      try {
        version = await httpJson(`${base}/json/version`, { timeoutMs: 1200 });
        break;
      } catch (e2) {
        lastErr = e2;
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    if (version?.webSocketDebuggerUrl) break;
    version = null;
    if (attempt < 2) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!version || !version.webSocketDebuggerUrl) {
    try { if (proc && !proc.killed) proc.kill(); } catch { /* gone */ }
    thePool.release(session);
    throw new Error('the browser debug port never came up — the browser may be blocked by a policy on this machine');
  }
  let ws = null;
  try {
    ws = await wsConnect(version.webSocketDebuggerUrl, wsFactory);
  const cdp = cdpRpc(ws);
  const sendRaw = ({ sessionId = null, method, params = {} }, opts = null) =>
    cdp(method, params, { sessionId, ...(opts || {}) });

  /* flat-mode attach: protocol messages carry the sessionId on the same
     websocket — the modern CDP layout, no nested sendMessageToTarget */
  const { targetId } = await cdp('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
  /* remember every tab alive AT BIRTH — headless keeps an initial about:blank
     tab around forever, and it is NOT ours to follow later (CI, twice). */
  const { targetInfos: bornTabs = [] } = await cdp('Target.getTargets');
  const close = () => {
    try { ws.close(); } catch { /* gone */ }
    try { if (!proc.killed) proc.kill(); } catch { /* gone */ }
    thePool.release(session);
    sess.delete(session);
  };
  const b = { session, sessionId, send: null, goto: null, eval: null, close, proc, slot, knownTabs: new Set(bornTabs.map((t) => t.targetId)) };
  /* send reads b.sessionId EVERY call — smarttab can re-wire it later */
  const send = (method, params = {}, opts = null) => sendRaw({ sessionId: b.sessionId, method, params }, opts);
  b.send = send;
  b.goto = async (u) => {
    await send('Page.enable');
    await send('Page.navigate', { url: u });
    /* Page.navigate returns at initiation, never at arrival — wait until the
       document actually answers, else every read-after-nav is a coin flip */
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const state = await b.eval('document.readyState');
        if (state === 'interactive' || state === 'complete') break;
      } catch { /* mid-navigation throws are normal */ }
    }
    /* evidence first: report what the PAGE says happened, not what we asked for */
    const rs = await b.eval('document.readyState');
    const meta = await b.eval('(() => ({ url: location.href, title: document.title }))()');
    return { readyState: rs, ...meta };
  };
  b.eval = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(String(r.exceptionDetails.text || 'evaluate threw'));
    return r.result ? r.result.value : undefined;
  };
  await b.goto(url);
  sess.set(session, b);

  /* smarttab: a click that opens a NEW page target must not strand the agent
     in the old, empty tab. 1.5 s window to catch the spawn, then re-attach. */
  b.followNewTarget = async ({ windowMs = 1500 } = {}) => {
    const deadline = Date.now() + windowMs;
    while (Date.now() < deadline) {
      const { targetInfos = [] } = await cdp('Target.getTargets');
      const mine = targetInfos.find((t) => t.targetId === targetId);
      /* a NEW tab, born after our spawn — never the stale initial blank tab */
      const spawnTarget = targetInfos.find((t) => t.type === 'page' && t.targetId !== targetId && !t.attached && !b.knownTabs.has(t.targetId));
      if (spawnTarget) {
        const { sessionId: s2 } = await cdp('Target.attachToTarget', { targetId: spawnTarget.targetId, flatten: true });
        b.sessionId = s2;
        const meta = await b.eval('(() => ({ url: location.href, title: document.title }))()');
        await new Promise((r) => setTimeout(r, 300));
        return { followed: true, ...meta };
      }
      if (!mine) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { followed: false };
  };
    return b;
  } catch (e) {
    /* safety net: a browser exists by now — never leak the process/ws/slot,
       whatever broke between spawn and a working session */
    try { ws?.close(); } catch { /* gone */ }
    try { if (!proc.killed) proc.kill(); } catch { /* gone */ }
    thePool.release(session);
    sess.delete(session);
    throw e;
  }
}

const randomPort = () => 49152 + Math.floor(Math.random() * 12000);

export function isOpen(session) {
  return sess.has(String(session || 'default'));
}

/** Close this task's browser (if any) and hand its slot back to the fleet. */
export function closeFor(session) {
  const b = sess.get(String(session || 'default'));
  if (!b) return false;
  try { b.close?.(); } catch { /* gone */ }
  return true;
}

/** tests + diagnostics only */
export function _resetBrowser() {
  for (const b of sess.values()) { try { b.close?.(); } catch { /* gone */ } }
  sess.clear();
  journal.bySession.clear();
}
