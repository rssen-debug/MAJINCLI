/**
 * Doctor and live activity: both read real state, and the prologue performs a
 * real write+read round trip against a loopback relay over a real socket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startControlledStack, RELAY_TOKEN } from './controlled-server.mjs';
import { runArenaDoctor, renderDoctor } from '../../../src/v6/arena/doctor.js';
import { createArenaPaths } from '../../../src/v6/arena/agent.js';
import { EventLog } from '../../../src/v6/events.js';
import { createBridgeServer } from '../../../src/v6/arena/server.js';
import { TaskQueue } from '../../../src/v6/queue.js';
import { POLICY_SCHEMA } from '../../../src/v6/arena/envelope.js';

const run = promisify(execFile);
const BIN = path.resolve('bin/majin-v6.mjs');

function freshHome(t, { policy = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-doctor-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const paths = createArenaPaths(root);
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  if (policy) fs.writeFileSync(paths.policy, JSON.stringify(policy));
  return { root, paths };
}

test('the doctor refuses to call an unconfigured bridge healthy', async (t) => {
  const { root } = freshHome(t);
  const report = await runArenaDoctor({ home: root });
  assert.equal(report.schema, 'majin.v6.arena.doctor/v1');
  assert.equal(report.verdict, 'BLOCKED');
  const policy = report.checks.find((check) => check.id === 'policy');
  assert.equal(policy.status, 'BLOCKED');
  assert.match(policy.fix, /arena init/);
  assert.ok(report.fixes.length >= 1);
  assert.match(renderDoctor(report), /verdict: BLOCKED/);
});

test('the doctor performs a real relay write+read when asked to probe', async (t) => {
  const server = await startControlledStack({});
  t.after(() => server.close());
  const { root, paths } = freshHome(t, {
    policy: {
      schema: POLICY_SCHEMA, keyId: 'ark_doctor',
      allowedKinds: ['health.delay'], allowedTools: [], allowIrreversible: false,
      relay: { type: 'http', url: server.url },
    },
  });
  fs.writeFileSync(paths.secret, 'x'.repeat(48), { mode: 0o600 });
  fs.writeFileSync(paths.token, 'y'.repeat(48), { mode: 0o600 });

  // Without --probe, nothing is written and the check says so.
  const passive = await runArenaDoctor({ home: root, env: { MAJIN_V6_SYNC_TOKEN: RELAY_TOKEN } });
  const passiveRelay = passive.checks.find((check) => check.id === 'relay-write');
  assert.equal(passiveRelay.status, 'NOT_TESTED');
  assert.notEqual(passive.verdict, 'PASS');

  const probed = await runArenaDoctor({ home: root, probe: true, env: { MAJIN_V6_SYNC_TOKEN: RELAY_TOKEN } });
  const relay = probed.checks.find((check) => check.id === 'relay-write');
  assert.equal(relay.status, 'PASS', relay.detail);
  assert.match(relay.detail, /read (it )?back/);
  // The probe really hit the relay: the object is in its outbox.
  assert.ok([...server.stats.outbox.keys()].some((key) => key.startsWith('probe-')), 'the probe object reached the relay');
  assert.equal(server.stats.submissions, 0, 'probing never submits anything');
});

test('doctor reports a missing relay token as BLOCKED, not as success', async (t) => {
  const { root, paths } = freshHome(t, {
    policy: {
      schema: POLICY_SCHEMA, keyId: 'ark_doctor',
      allowedKinds: ['health.delay'], allowedTools: [], allowIrreversible: false,
      relay: { type: 'github', repo: 'owner/private-relay', path: 'arena' },
    },
  });
  fs.writeFileSync(paths.secret, 'x'.repeat(48), { mode: 0o600 });
  fs.writeFileSync(paths.token, 'y'.repeat(48), { mode: 0o600 });
  const report = await runArenaDoctor({ home: root, probe: true, env: {} });
  const token = report.checks.find((check) => check.id === 'relay-token');
  assert.equal(token.status, 'BLOCKED');
  assert.match(token.fix, /Contents: Read and write/);
  assert.equal(report.verdict, 'BLOCKED');
});

test('a token that cannot see the repository is reported as a scope problem', async (t) => {
  const { root, paths } = freshHome(t, {
    policy: {
      schema: POLICY_SCHEMA, keyId: 'ark_doctor',
      allowedKinds: ['health.delay'], allowedTools: [], allowIrreversible: false,
      relay: { type: 'github', repo: 'owner/private-relay', path: 'arena' },
    },
  });
  fs.writeFileSync(paths.secret, 'x'.repeat(48), { mode: 0o600 });
  fs.writeFileSync(paths.token, 'y'.repeat(48), { mode: 0o600 });
  // A real GitHub 403 body for a fine-grained token without repository access.
  const fetchImpl = async () => new Response(JSON.stringify({
    message: 'Resource not accessible by integration',
    documentation_url: 'https://docs.github.com/rest/repos/repos#get-a-repository',
  }), { status: 403, headers: { 'content-type': 'application/json' } });

  const report = await runArenaDoctor({
    home: root, probe: true, fetchImpl, env: { MAJIN_V6_SYNC_TOKEN: 'ghp_example' },
  });
  const relay = report.checks.find((check) => check.id === 'relay-write');
  assert.equal(relay.status, 'BLOCKED', relay.detail);
  assert.match(relay.detail, /SYNC_TOKEN_SCOPE_DENIED/);
  assert.match(relay.detail, /not granted access/);
  assert.match(relay.fix, /Contents: Read and write/);
});

test('event sequence numbers stay unique across processes, so live views do not drop lines', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-seq-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = new EventLog(root);
  const second = new EventLog(root); // a second worker process
  first.append('heartbeat', { who: 'a1' });
  second.append('heartbeat', { who: 'b1' });
  first.append('heartbeat', { who: 'a2' });
  second.append('heartbeat', { who: 'b2' });
  const seqs = first.read({ limit: 10 }).map((event) => event.seq);
  assert.equal(seqs.length, 4);
  assert.equal(new Set(seqs).size, 4, `duplicate sequence numbers: ${seqs.join(',')}`);
});

test('the bridge serves live activity with a monotonic cursor', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-activity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = new EventLog(path.join(root, 'events'));
  const queue = new TaskQueue({ file: path.join(root, 'queue.json'), log });
  const bridge = createBridgeServer({
    token: 't'.repeat(32), policy: { keyId: 'k', allowedKinds: [], allowedTools: [] }, secret: 's'.repeat(32),
    queue, log, home: root, port: 0,
  });
  const address = await bridge.listen();
  t.after(() => bridge.close());

  log.append('task.queued', { taskId: 'tsk_1', kind: 'tool' });
  log.append('tool.completed', { taskId: 'tsk_1', tool: 'fs_read' });

  const response = await fetch(`${address.url}/v1/activity?limit=10`, {
    headers: { authorization: `Bearer ${'t'.repeat(32)}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema, 'majin.v6.arena.activity/v1');
  assert.equal(body.items.length, 2);
  assert.ok(body.cursor > 0);
  assert.ok(body.items.every((item) => typeof item.line === 'string' && item.line.length > 0));
  assert.ok(body.queue, 'the same payload carries real queue counts');

  const after = await (await fetch(`${address.url}/v1/activity?since=${body.cursor}`, {
    headers: { authorization: `Bearer ${'t'.repeat(32)}` },
  })).json();
  assert.equal(after.items.length, 0, 'the cursor only returns newer events');

  const unauth = await fetch(`${address.url}/v1/activity`);
  assert.equal(unauth.status, 401, 'activity is not public');
});

test('the watch command prints real activity lines from the persisted log', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const log = new EventLog(path.join(root, 'events'));
  log.append('task.queued', { taskId: 'tsk_9', kind: 'tool' });
  log.append('tool.completed', { taskId: 'tsk_9', tool: 'fs_read' });

  const result = await run(process.execPath, [BIN, 'arena', 'watch', '--once', '--lines', '5', '--v6-home', root], {
    timeout: 30000, env: { ...process.env, MAJIN_V6_HOME: root },
  });
  assert.match(result.stdout, /Arena activity/);
  assert.match(result.stdout, /Task queued|Tool completed/);
  assert.match(result.stdout, /queue: /);
});
