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
import { AuditChain } from '../audit/chain.js';
import { aggregate } from '../telemetry/aggregate.js';
import { EVENT_NAMES } from '../runtime/events.js';
import { renderStudioPage } from './page.js';

const HEARTBEAT_MS = 15000;
const REPLAY_LIMIT = 100;

export function createStudioServer({
  bus,
  telemetryDir,
  auditDir,
  page = renderStudioPage(),
} = {}) {
  if (!bus) throw new Error('studio requires an EventBus');
  if (!telemetryDir) throw new Error('studio requires telemetryDir');
  if (!auditDir) throw new Error('studio requires auditDir');

  const clients = new Set();
  const unsubs = EVENT_NAMES.map((name) =>
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

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://studio.local');

    if (req.method !== 'GET') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'read-only surface', method: req.method }));
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

    if (url.pathname === '/api/audit/verify') {
      // fresh instance — verification never trusts the server's in-memory view
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
