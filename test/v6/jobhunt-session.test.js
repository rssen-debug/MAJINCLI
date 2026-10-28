import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JobHuntSession } from '../../src/v6/jobhunt/session.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobhunt-session-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let now = Date.parse('2026-10-27T10:00:00.000Z');
  const session = new JobHuntSession({ home, clock: () => now });
  return { home, session, advance: (ms) => { now += ms; }, now: () => now };
}

test('a session keeps one absolute deadline across restart and does not reset the duration', async (t) => {
  const { home, session, advance, now } = fixture(t);
  const started = await session.start({ durationMs: 120 * 60 * 1000, candidateId: 'lavinia', queries: ['social media'], now: now() });
  const deadline = new Date(started.deadlineAt).getTime();
  assert.equal(deadline, now() + 120 * 60 * 1000);

  advance(15 * 60 * 1000);
  const restarted = new JobHuntSession({ home, clock: now });
  const described = restarted.describe(restarted.read(), now());
  assert.equal(new Date(described.deadlineAt).getTime(), deadline);
  assert.equal(described.remainingMs, 105 * 60 * 1000);
});

test('pause and resume preserve the original deadline and elapsed wall clock', async (t) => {
  const { session, advance, now } = fixture(t);
  await session.start({ durationMs: 60 * 60 * 1000, candidateId: 'lavinia', queries: ['content creator'], now: now() });
  advance(5 * 60 * 1000);
  await session.pause({ now: now() });
  assert.equal(session.read().status, 'PAUSED');
  advance(10 * 60 * 1000);
  await session.resume({ now: now() });
  const described = session.describe(session.read(), now());
  assert.equal(described.effectiveStatus, 'RUNNING');
  assert.equal(described.remainingMs, 45 * 60 * 1000);
  assert.equal(described.pausedTotalMs, 10 * 60 * 1000);
});

test('an active session cannot be restarted and an expired session cannot be resumed', async (t) => {
  const { session, advance, now } = fixture(t);
  await session.start({ durationMs: 10 * 60 * 1000, candidateId: 'lavinia', queries: [], now: now() });
  await assert.rejects(() => session.start({ durationMs: 10 * 60 * 1000, candidateId: 'lavinia', now: now() }), /already RUNNING/i);
  advance(10 * 60 * 1000);
  const described = session.describe(session.read(), now());
  assert.equal(described.effectiveStatus, 'EXPIRED');
  assert.equal(described.remainingMs, 0);
  await assert.rejects(() => session.resume({ now: now() }), /deadline|resumed/i);
});

test('stop writes a safe stop marker and a partial completion is recorded', async (t) => {
  const { session, now } = fixture(t);
  await session.start({ durationMs: 60 * 60 * 1000, candidateId: 'lavinia', queries: [], now: now() });
  await session.stop({ now: now(), reason: 'owner-test' });
  assert.equal(session.read().status, 'STOPPED');
  assert.equal(session.stopRequested(), true);
  const completed = await session.complete({ status: 'STOPPED', reports: { html: 'x.html', xlsx: 'x.xlsx' }, now: now() });
  assert.equal(completed.status, 'STOPPED');
  assert.equal(completed.reports.html, 'x.html');
});

test('simulated 320m and 10000m sessions keep their exact absolute deadlines', async (t) => {
  for (const [label, ms] of [['320m', 320 * 60 * 1000], ['10000m', 10000 * 60 * 1000]]) {
    const { session, advance, now } = fixture(t);
    const started = await session.start({ durationMs: ms, candidateId: 'lavinia', queries: [], now: now() });
    assert.equal(new Date(started.deadlineAt).getTime() - now(), ms, label);
    advance(ms - 1);
    const almost = session.describe(session.read(), now());
    assert.equal(almost.remainingMs, 1, label);
    assert.equal(almost.effectiveStatus, 'RUNNING', label);
    advance(1);
    assert.equal(session.describe(session.read(), now()).effectiveStatus, 'EXPIRED', label);
  }
});

test('a failed mission can be resumed within its original deadline', async (t) => {
  const { session, advance, now } = fixture(t);
  const started = await session.start({ durationMs: 60 * 60 * 1000, candidateId: 'lavinia', queries: [], now: now() });
  await session.complete({ status: 'FAILED', error: 'transient state write', now: now() });
  advance(10 * 60 * 1000);
  const resumed = await session.resume({ now: now() });
  assert.equal(resumed.status, 'RUNNING');
  assert.equal(new Date(resumed.deadlineAt).getTime(), new Date(started.deadlineAt).getTime());
});

test('no-AI policy survives pause and a fresh process reading the session', async t => {
  const { session, now } = fixture(t);
  await session.start({ durationMs: 60000, candidateId: 'lavinia', aiDisabled: true, now: now() });
  await session.pause({ now: now() });
  const restored = new JobHuntSession({ home: session.home, clock: now });
  assert.equal((await restored.resume({ now: now() })).aiDisabled, true);
});
