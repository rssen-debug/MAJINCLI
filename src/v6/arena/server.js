/**
 * MAJIN V6 — local Arena bridge (loopback only).
 *
 * For a planner that runs *on the same machine* (Arena desktop, a local agent,
 * or a script). It is not exposed to the internet: it binds 127.0.0.1, requires
 * a bearer token, rejects non-loopback Host headers (DNS rebinding), sends no
 * CORS headers, caps request size and rate-limits per client.
 *
 * Remote planners use the relay instead; this server is the local door.
 */
import fs from 'node:fs';
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ArenaError, signEnvelope } from './envelope.js';
import { buildReport } from '../report.js';

const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT = { windowMs: 60_000, max: 60 };

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  if (!b.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isLoopbackHost(hostHeader) {
  if (!hostHeader) return false;
  const host = String(hostHeader).toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ArenaError('Request body is too large', 'ARENA_BODY_TOO_LARGE'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

export function createBridgeServer({
  token, policy, secret, queue, log, home, reportFn = null, clock = Date.now,
  host = '127.0.0.1', port = null, fetchReport = null,
} = {}) {
  if (!token || String(token).length < 16) throw new ArenaError('Bridge token is missing or too short', 'ARENA_TOKEN_MISSING');
  const buckets = new Map();

  function rateLimited(remote) {
    const now = clock();
    const bucket = buckets.get(remote) || { startedAt: now, count: 0 };
    if (now - bucket.startedAt > RATE_LIMIT.windowMs) {
      bucket.startedAt = now;
      bucket.count = 0;
    }
    bucket.count += 1;
    buckets.set(remote, bucket);
    return bucket.count > RATE_LIMIT.max;
  }

  const json = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(`${JSON.stringify(body)}\n`);
  };

  async function handle(request, response) {
    const remote = request.socket.remoteAddress || 'unknown';
    if (!isLoopbackHost(request.headers.host)) return json(response, 421, { error: 'BAD_HOST', message: 'Bridge only accepts loopback Host headers' });
    if (rateLimited(remote)) return json(response, 429, { error: 'RATE_LIMITED' });

    const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
    if (url.pathname === '/healthz' && request.method === 'GET') {
      const stats = queue ? await queue.stats() : null;
      return json(response, 200, { ok: true, service: 'majin-arena-bridge', loopbackOnly: true, queue: stats });
    }
    if (!url.pathname.startsWith('/v1/')) return json(response, 404, { error: 'NOT_FOUND' });

    const auth = String(request.headers.authorization || '');
    const provided = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!constantTimeEqual(provided, token)) {
      log?.append('arena.refused', { workerId: 'bridge', code: 'ARENA_BRIDGE_UNAUTHORIZED', path: url.pathname });
      return json(response, 401, { error: 'UNAUTHORIZED' });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        const report = fetchReport ? await fetchReport() : await buildReport({ queue, log, home });
        return json(response, 200, report);
      }
      if (request.method === 'POST' && url.pathname === '/v1/tasks') {
        if (!String(request.headers['content-type'] || '').includes('application/json')) {
          return json(response, 415, { error: 'CONTENT_TYPE' });
        }
        let body;
        try { body = JSON.parse(await readBody(request)); } catch { return json(response, 400, { error: 'INVALID_JSON' }); }
        const allowedKinds = policy?.allowedKinds || [];
        if (!allowedKinds.includes(body.kind)) return json(response, 403, { error: 'KIND_NOT_ALLOWED', allowedKinds });
        if (body.kind === 'tool' && !(policy?.allowedTools || []).includes(body.payload?.tool)) {
          return json(response, 403, { error: 'TOOL_NOT_ALLOWED' });
        }
        const irreversible = body.irreversible === true || body.kind === 'job.submit';
        if (irreversible && policy?.allowIrreversible !== true) return json(response, 403, { error: 'IRREVERSIBLE_NOT_ALLOWED' });
        const envelope = signEnvelope({
          secret, keyId: policy.keyId, now: clock,
          ttlMs: body.ttlMs,
          task: {
            kind: body.kind, title: body.title, payload: body.payload,
            irreversible, maxAttempts: body.maxAttempts,
          },
          policy: { allowTools: body.kind === 'tool' ? [body.payload?.tool] : [] },
        });
        const added = await queue.add({
          kind: envelope.kind, title: envelope.title, payload: envelope.payload,
          dedupeKey: `arena:${envelope.id}`,
          effectKey: envelope.irreversible ? `arena-effect:${envelope.id}` : null,
          irreversible: envelope.irreversible,
          maxAttempts: envelope.maxAttempts,
          by: 'arena-local',
        });
        log?.append('arena.accepted', { workerId: 'bridge', envelopeId: envelope.id, taskId: added.task.id, kind: envelope.kind });
        return json(response, 202, { envelopeId: envelope.id, task: added.task, deduplicated: added.deduplicated });
      }
      const match = /^\/v1\/tasks\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
      if (request.method === 'GET' && match) {
        const task = await queue.get(match[1]);
        if (!task) return json(response, 404, { error: 'TASK_NOT_FOUND' });
        return json(response, 200, task);
      }
      if (request.method === 'POST' && url.pathname === '/v1/stop') {
        fs.mkdirSync(`${home}`, { recursive: true });
        fs.writeFileSync(`${home}/STOP`, JSON.stringify({ requestedAt: new Date(clock()).toISOString(), by: 'arena-bridge' }), { mode: 0o600 });
        return json(response, 202, { stopRequested: true });
      }
      return json(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    } catch (error) {
      log?.append('engine.error', { workerId: 'bridge', code: error.code || 'ARENA_BRIDGE_ERROR' });
      return json(response, error instanceof ArenaError ? 400 : 500, { error: error.code || 'ARENA_BRIDGE_ERROR', message: String(error.message || error).slice(0, 300) });
    }
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch(() => {
      try { response.writeHead(500, { 'content-type': 'application/json' }); response.end('{"error":"INTERNAL"}'); } catch { /* socket already closed */ }
    });
  });

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port ?? policy?.server?.port ?? 8787, host, () => {
          server.removeListener('error', reject);
          const address = server.address();
          resolve({ host: address.address, port: address.port, url: `http://${host}:${address.port}` });
        });
      });
    },
    close() {
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

export function loadBridgeToken(file, { fsImpl = fs } = {}) {
  let raw;
  try { raw = fsImpl.readFileSync(file, 'utf8').trim(); } catch {
    throw new ArenaError('Bridge token not found; run `majin-v6 arena init` first', 'ARENA_TOKEN_MISSING');
  }
  if (raw.length < 16) throw new ArenaError('Bridge token is too short', 'ARENA_TOKEN_MISSING');
  return raw;
}
