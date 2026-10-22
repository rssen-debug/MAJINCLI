/**
 * MAJIN V2 Studio server — read-only operator surface over the REAL kernel
 * objects (EventBus, TelemetryLedger shards, AuditChain). Zero deps: node:http.
 *
 * Architecture pattern reused (logged in DEPENDENCIES_AND_LICENSES.md), not
 * code: opencode's server split — REST for documents, SSE for the live stream:
 *   GET /                    inline single-file page (no external assets)
 *   GET /api/events          SSE: synthetic server.connected first, ring-buffer
 *                            replay, then live bus events, heartbeat comments
 *   GET /api/telemetry?days  aggregate() JSON over the ledger shards
 *   GET /api/audit/verify    AuditChain.verify() — the honest verdict as-is
 *
 * Safety: read-only BY CONSTRUCTION — there are no POST/PUT/DELETE routes at
 * all; nothing in this process can mutate goals, consents or files. Operator
 * write actions belong to a later lane behind approvals.check(), never here.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AuditChain, AUDIT_FILE } from '../audit/chain.js';
import { aggregate } from '../telemetry/aggregate.js';
import { EVENT_NAMES } from '../runtime/events.js';

// consent lifecycle travels on these names (approvals.js emits them; EVENT_NAMES
// is the kernel-centric list — operator surfaces need both)
const STUDIO_EVENT_NAMES = [...new Set([...EVENT_NAMES, 'task.updated', 'consent.revoked', 'consent.expired', 'approval.required'])];
import { renderStudioPage } from './page.js';

const HEARTBEAT_MS = 15000;
const REPLAY_LIMIT = 100;

/** fresh-instance verification — endpoint answers never trust server memory */
function safeChainVerify(auditDir) {
  try {
    return new AuditChain(auditDir).verify();
  } catch (err) {
    return { ok: false, reason: err.cls || 'FAILED', detail: String(err.message || err) };
  }
}

function readChainEntries(auditDir) {
  const file = path.join(auditDir, AUDIT_FILE);
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, 'utf8').trim();
  if (!text) return [];
  const out = [];
  for (const line of text.split('\n')) {
    try { out.push(JSON.parse(line)); } catch { /* the verify() verdict above carries the truth; a partial line just does not render */ }
  }
  return out;
}

/** operator-friendly payload projection: keep it shallow and small */
function summarize(payload) {
  const out = {};
  for (const k of Object.keys(payload || {}).slice(0, 10)) {
    const v = payload[k];
    out[k] = typeof v === 'object' && v !== null ? '[obj]' : v;
  }
  return out;
}

export function createStudioServer({
  bus,
  telemetryDir,
  auditDir,
  page = null, // default built AFTER enableWrites is known — the UI never lies about the gate
  approvals = null,      // Approvals instance — required when enableWrites
  enableWrites = false,  // consent write surface; OFF unless explicitly enabled
} = {}) {
  if (!bus) throw new Error('studio requires an EventBus');
  if (!telemetryDir) throw new Error('studio requires telemetryDir');
  if (!auditDir) throw new Error('studio requires auditDir');
  if (enableWrites && !approvals) throw new Error('enableWrites requires an Approvals instance');
  if (page == null) page = renderStudioPage({ enableWrites });

  const clients = new Set();
  const unsubs = STUDIO_EVENT_NAMES.map((name) =>
    bus.on(name, (event) => {
      const frame = `data: ${JSON.stringify(event)}\n\n`;
      for (const res of clients) {
        try { res.write(frame); } catch { clients.delete(res); }
      }
    })
  );

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try { res.write(`: hb ${Date.now()}\n\n`); } catch { clients.delete(res); }
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  const MAX_BODY = 8192;
  const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      // drain-and-discard past the cap: destroying the socket mid-upload would
      // give the client ECONNRESET and no answer; a 413 must always LAND.
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { tooLarge = true; return; }
        if (!tooLarge) chunks.push(c);
      });
      req.on('end', () => {
        if (tooLarge) reject(Object.assign(new Error('body too large'), { code: 413 }));
        else resolve(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', reject);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://studio.local');

    // ---- consent write surface ( Approvals is the only authority; studio is a gate ) ----
    if (req.method === 'POST' && url.pathname === '/api/consent') {
      if (!enableWrites) {
        json(res, 403, { error: 'writes disabled', detail: 'consent writes require starting studio with enableWrites — silence/disabled means NO, never a silent grant' });
        return;
      }
      let body;
      try {
        const raw = await readBody(req);
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        json(res, err.code === 413 ? 413 : 400, { error: err.code === 413 ? 'body too large' : 'invalid JSON body' });
        return;
      }
      const { scope, user, mode, maxUses, ttlMs } = body;
      if (typeof scope !== 'string' || !scope || scope.length > 256) {
        json(res, 400, { error: 'scope must be a non-empty string (max 256 chars)' });
        return;
      }
      try {
        // Approvals enforces: named human required, known mode required.
        // rejections are DATA the operator needs — surface them, never mask.
        approvals.grant(scope, { user, mode, maxUses, ttlMs });
      } catch (err) {
        json(res, 400, { error: String(err.message || err), scope });
        return;
      }
      json(res, 201, { granted: scope, status: approvals.status(scope) });
      return;
    }

    if (req.method === 'DELETE' && url.pathname === '/api/consent') {
      if (!enableWrites) {
        json(res, 403, { error: 'writes disabled' });
        return;
      }
      const scope = url.searchParams.get('scope');
      if (!scope) {
        json(res, 400, { error: 'DELETE /api/consent requires ?scope=' });
        return;
      }
      const existed = approvals.status(scope).granted;
      approvals.revoke(scope);
      json(res, 200, { revoked: scope, existed });
      return;
    }

    if (req.method !== 'GET') {
      json(res, 405, { error: 'unsupported method on this surface', method: req.method });
      return;
    }

    if (url.pathname === '/api/consent/status') {
      if (!approvals) {
        json(res, 503, { error: 'no approvals instance wired', granted: false });
        return;
      }
      const scope = url.searchParams.get('scope');
      if (!scope) {
        json(res, 400, { error: 'requires ?scope=' });
        return;
      }
      json(res, 200, approvals.status(scope));
      return;
    }

    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page);
      return;
    }

    if (url.pathname === '/api/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });
      // synthetic first event — the observation boundary marker (opencode shape)
      res.write(`data: ${JSON.stringify({ type: 'server.connected', at: new Date().toISOString() })}\n\n`);
      for (const e of bus.audit({ last: REPLAY_LIMIT })) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
      }
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (url.pathname === '/api/telemetry') {
      const days = Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 7));
      try {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(aggregate(telemetryDir, { lastDays: days })));
      } catch (err) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
      return;
    }

    if (url.pathname === '/api/audit/verify') {      // fresh instance — verification never trusts the server's in-memory view
      let verdict;
      try {
        verdict = new AuditChain(auditDir).verify();
      } catch (err) {
        verdict = { ok: false, reason: err.cls || 'FAILED', detail: String(err.message || err) };
      }
      res.writeHead(200, { 'content-type': 'application/json' }); // verdict is DATA — a broken chain is not a transport failure
      res.end(JSON.stringify(verdict));
      return;
    }

    if (url.pathname === '/api/receipts') {
      // receipts are chain entries of kind 'receipt' — the chain is the ONLY
      // source of truth; a broken chain yields an honest empty answer with
      // the reason attached, never silently stale "facts"
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
      const goalId = url.searchParams.get('goalId');
      const verdict = safeChainVerify(auditDir);
      if (!verdict.ok) {
        json(res, 200, { ok: false, reason: verdict.reason, receipts: [], note: 'chain broken — receipts withheld, not presented as fact' });
        return;
      }
      let entries = readChainEntries(auditDir).filter((e) => e.kind === 'receipt');
      if (goalId) entries = entries.filter((e) => e.payload.goalId === goalId);
      const receipts = entries.slice(-limit).map((e) => ({ seq: e.seq, at: e.ts, ...e.payload }));
      json(res, 200, { ok: true, count: receipts.length, goalId: goalId || null, receipts });
      return;
    }

    if (url.pathname === '/api/chain/tail') {
      const n = Math.max(1, Math.min(100, Number(url.searchParams.get('n')) || 20));
      const verdict = safeChainVerify(auditDir);
      if (!verdict.ok) {
        json(res, 200, { ok: false, reason: verdict.reason, entries: [] });
        return;
      }
      const entries = readChainEntries(auditDir).slice(-n).map((e) => ({ seq: e.seq, at: e.ts, kind: e.kind, actor: e.actor, ...summarize(e.payload) }));
      json(res, 200, { ok: true, count: entries.length, entries });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
  });

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const u of unsubs) u();
  });

  /** listen(): returns actual bound address (port 0 — ephemeral — supported) */
  function listen({ port = 0, host = '127.0.0.1' } = {}) {
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const addr = server.address();
        resolve({ host: addr.address, port: addr.port, url: `http://${addr.address}:${addr.port}` });
      });
    });
  }

  // close(): deterministic — long-lived SSE keep-alives never stall teardown
  function close() {
    return new Promise((resolve) => {
      for (const res of clients) { try { res.end(); } catch { /* already gone */ } }
      clients.clear();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }

  return { server, listen, close };
}
