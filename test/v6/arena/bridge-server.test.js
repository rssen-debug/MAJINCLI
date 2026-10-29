import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBridgeServer } from '../../../src/v6/arena/server.js';
import { createSecret, generateKeyId } from '../../../src/v6/arena/envelope.js';
import { openV6 } from '../../../src/v6/home.js';

async function fixture(t, { token = createSecret() } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-server-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ctx = openV6({ home: path.join(root, 'v6') });
  const policy = {
    keyId: generateKeyId(),
    allowedKinds: ['tool', 'health.delay'],
    allowedTools: ['fs_read'],
    allowIrreversible: false,
  };
  const bridge = createBridgeServer({
    token, policy, secret: createSecret(), queue: ctx.queue, log: ctx.log,
    home: ctx.home, port: 0,
  });
  const address = await bridge.listen();
  t.after(() => bridge.close());
  const call = (pathname, { method = 'GET', body = null, headers = {} } = {}) => fetch(`${address.url}${pathname}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { root, ctx, policy, bridge, address, call, token };
}

test('the bridge binds loopback and exposes health without a token', async (t) => {
  const { address } = await fixture(t);
  assert.equal(address.host, '127.0.0.1');
  const health = await fetch(`${address.url}/healthz`);
  assert.equal(health.status, 200);
  const body = await health.json();
  assert.equal(body.service, 'majin-arena-bridge');
  assert.equal(body.loopbackOnly, true);
});

test('every /v1 endpoint requires the bearer token', async (t) => {
  const { address } = await fixture(t);
  const noToken = await fetch(`${address.url}/v1/status`);
  assert.equal(noToken.status, 401);
  const wrong = await fetch(`${address.url}/v1/status`, { headers: { authorization: 'Bearer nope-nope-nope-nope' } });
  assert.equal(wrong.status, 401);
  const healthSpoof = await fetch(`${address.url}/healthz`);
  assert.equal(healthSpoof.status, 200, 'health is intentionally unauthenticated but holds no queue payload');
});

test('a foreign Host header is rejected to block DNS rebinding', async (t) => {
  const { address, token } = await fixture(t);
  const response = await fetch(`${address.url}/v1/status`, {
    headers: { authorization: `Bearer ${token}`, host: 'evil.example.com' },
  });
  // fetch may refuse to override Host; the server-side check is what matters.
  assert.ok([421, 401].includes(response.status) || response.status === 200, `unexpected ${response.status}`);
  const direct = await new Promise((resolve, reject) => {
    import('node:net').then(({ createConnection }) => {
      const socket = createConnection(address.port, '127.0.0.1', () => {
        socket.write(`GET /v1/status HTTP/1.1\r\nHost: evil.example.com\r\nAuthorization: Bearer ${token}\r\nConnection: close\r\n\r\n`);
      });
      let data = '';
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
  });
  assert.match(direct, /^HTTP\/1\.1 421/);
});

test('a signed task is enqueued once and is visible through the task endpoint', async (t) => {
  const { call, ctx } = await fixture(t);
  const created = await call('/v1/tasks', {
    method: 'POST',
    body: { kind: 'health.delay', payload: { ms: 1 }, title: 'from arena' },
  });
  assert.equal(created.status, 202);
  const body = await created.json();
  assert.ok(body.envelopeId);
  assert.equal(body.task.kind, 'health.delay');

  const fetched = await call(`/v1/tasks/${body.task.id}`);
  assert.equal(fetched.status, 200);
  assert.equal((await fetched.json()).title, 'from arena');

  const duplicate = await call('/v1/tasks', {
    method: 'POST',
    body: { kind: 'health.delay', payload: { ms: 1 } },
  });
  assert.equal(duplicate.status, 202, 'a new envelope is a new unit of work');
  assert.equal((await ctx.queue.stats()).byState.QUEUED, 2);
});

test('the bridge refuses unlisted kinds, unlisted tools and irreversible work', async (t) => {
  const { call } = await fixture(t);
  const kind = await call('/v1/tasks', { method: 'POST', body: { kind: 'job.submit', payload: {} } });
  assert.equal(kind.status, 403);
  assert.equal((await kind.json()).error, 'KIND_NOT_ALLOWED');

  const tool = await call('/v1/tasks', { method: 'POST', body: { kind: 'tool', payload: { tool: 'shell_run', arguments: {} } } });
  assert.equal(tool.status, 403);
  assert.equal((await tool.json()).error, 'TOOL_NOT_ALLOWED');

  const allowed = await call('/v1/tasks', { method: 'POST', body: { kind: 'tool', payload: { tool: 'fs_read', arguments: { path: 'a' } } } });
  assert.equal(allowed.status, 202);

  const irreversible = await call('/v1/tasks', { method: 'POST', body: { kind: 'health.delay', payload: {}, irreversible: true } });
  assert.equal(irreversible.status, 403);
  assert.equal((await irreversible.json()).error, 'IRREVERSIBLE_NOT_ALLOWED');
});

test('wrong content type, oversized bodies and bad JSON are rejected', async (t) => {
  const { address, token } = await fixture(t);
  const plain = await fetch(`${address.url}/v1/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'text/plain' },
    body: '{"kind":"health.delay"}',
  });
  assert.equal(plain.status, 415);

  const badJson = await fetch(`${address.url}/v1/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{not json',
  });
  assert.equal(badJson.status, 400);

  const huge = await fetch(`${address.url}/v1/tasks`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'health.delay', payload: { blob: 'x'.repeat(300 * 1024) } }),
  }).catch(() => ({ status: 0 }));
  assert.ok([400, 413, 0].includes(huge.status), `oversized body must not be accepted (got ${huge.status})`);
});

test('request rate is bounded per client', async (t) => {
  const { address, token } = await fixture(t);
  let limited = 0;
  for (let index = 0; index < 70; index += 1) {
    const response = await fetch(`${address.url}/healthz`, { headers: { authorization: `Bearer ${token}` } });
    if (response.status === 429) limited += 1;
  }
  assert.ok(limited > 0, 'the bridge must rate-limit a burst');
});

test('the bridge refuses to start without a usable token', () => {
  assert.throws(() => createBridgeServer({ token: 'short', policy: {}, queue: null }), (error) => error.code === 'ARENA_TOKEN_MISSING');
});
