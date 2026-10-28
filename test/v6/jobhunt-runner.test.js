import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventLog } from '../../src/v6/events.js';
import { TaskQueue } from '../../src/v6/queue.js';
import { JobStore } from '../../src/v6/jobs/store.js';
import { Supervisor } from '../../src/v6/supervisor.js';
import { JobHuntSession } from '../../src/v6/jobhunt/session.js';
import { runJobHunt } from '../../src/v6/jobhunt/runner.js';
import { writeJobHuntReports } from '../../src/v6/jobhunt/report.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobhunt-runner-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const log = new EventLog(path.join(home, 'events'));
  const queue = new TaskQueue({ file: path.join(home, 'queue.json'), log });
  const jobs = new JobStore({ file: path.join(home, 'jobs.json'), log });
  const profile = {
    id: 'lavinia', displayName: 'Lavinia', cvPath: 'C:/cv.pdf', contactEmail: 'x@example.com',
    gmailAccount: 'x@example.com', exclusions: { companies: [], roles: [], locations: [] },
    rules: { locationsAllow: [], remoteOk: true, minScore: 0.2 },
    approval: { policy: 'owner-review', authorizedCompanies: [] },
    quotas: { maxApplicationsPerRun: 20, maxPerDay: 20 },
  };
  const hunter = { profile: () => ({ ok: true, profile }) };
  return {
    home, log, queue, jobs,
    ctx: {
      home, log, queue, jobs,
      workersDir: path.join(home, 'workers'),
      reportsDir: path.join(home, 'reports'),
      hunter,
    },
  };
}

test('persisted no-AI session prevents provider invocation after restart', async t => {
  const { ctx } = fixture(t);
  let now = Date.now();
  const session = new JobHuntSession({ home: ctx.home, clock: () => now });
  await session.start({ durationMs: 2000, candidateId: 'lavinia', aiDisabled: true });
  let calls = 0;
  await runJobHunt({ ctx, session, clock: () => now,
    sleepFn: async ms => { now += ms; }, planner: async () => 0,
    maxRounds: 0, maxAiCalls: 80, head: async () => { calls++; return {}; },
    writeReportFn: async () => ({ html: 'test.html', xlsx: 'test.xlsx' }) });
  assert.equal(calls, 0);
});

test('a completed worker batch does not end the Job Hunter and no task starts after the absolute deadline', async (t) => {
  const { ctx, queue, log } = fixture(t);
  let now = Date.parse('2026-10-27T10:00:00.000Z');
  queue.clock = () => now;
  const session = new JobHuntSession({ home: ctx.home, clock: () => now });
  await session.start({ durationMs: 120 * 60 * 1000, candidateId: 'lavinia', queries: ['social media'], now });
  await session.checkpoint({ round: 1 }, { now });
  let ticks = 0;
  const supervisorFactory = () => new Supervisor({
    queue,
    log,
    handlers: {
      'test.tick': async () => {
        ticks += 1;
        now += 30 * 60 * 1000;
        return { ok: true, summary: `tick ${ticks}` };
      },
    },
    workerId: 'test-jobhunt',
    heartbeatFile: path.join(ctx.workersDir, 'test-jobhunt.json'),
    stopFile: session.stopFile,
    clock: () => now,
    limits: { maxTasks: 1, maxRuntimeMs: 5 * 60 * 1000, taskTimeoutMs: 5 * 60 * 1000, stallMs: 5000, pollMs: 10 },
    onTaskSettled: async () => { await session.checkpoint({ counts: { evaluated: ticks } }, { now }); },
  });
  const result = await runJobHunt({
    ctx,
    session,
    clock: () => now,
    sleepFn: async (ms) => { now += Math.min(ms, 1000); },
    replanMs: 1000,
    maxBatch: 1,
    maxAiCalls: 0,
    planner: async () => { await queue.add({ kind: 'test.tick', title: 'tick' }); return 1; },
    supervisorFactory,
    writeReportFn: async () => ({ html: 'report.html', xlsx: 'report.xlsx' }),
  });

  assert.equal(result.status, 'EXPIRED');
  assert.equal(ticks, 4, 'four 30-minute batches fit inside 120 minutes');
  assert.equal(now, Date.parse('2026-10-27T12:00:00.000Z'));
  const stored = await session.read();
  assert.equal(stored.status, 'EXPIRED');
  assert.deepEqual(stored.reports, { html: 'report.html', xlsx: 'report.xlsx' });
  assert.equal(stored.runnerPid, null);
  assert.ok(ticks <= 4, 'no task was started after the deadline');
});

test('HTML and Excel reports are written from real persisted job state', async (t) => {
  const { ctx, jobs } = fixture(t);
  const now = Date.now();
  const session = new JobHuntSession({ home: ctx.home, clock: () => now });
  await session.start({ durationMs: 60 * 60 * 1000, candidateId: 'lavinia', queries: [], now });
  const { application } = await jobs.upsertDiscovered({
    site: 'test', siteId: '1', title: 'Content Creator', company: 'Acme Studio',
    city: 'MalmÃ¶', url: 'https://example.com/jobs/1',
  }, 'lavinia');
  application.state = 'CONFIRMED_RECEIVED';
  application.evidence.push({ type: 'gmail-confirmation', at: new Date(now).toISOString(), messageId: 'msg-1' });
  application.history.push({ state: 'CONFIRMED_RECEIVED', at: new Date(now).toISOString(), by: 'test' });
  await jobs.save(application);

  const report = await writeJobHuntReports({ ctx, session, finalStatus: 'COMPLETED', now });
  assert.equal(report.counts.reviewed, 1);
  assert.equal(report.counts.verified, 1);
  assert.equal(report.counts.receipts, 1);
  assert.ok(fs.existsSync(report.html));
  assert.ok(fs.existsSync(report.xlsx));
  const html = fs.readFileSync(report.html, 'utf8');
  assert.match(html, /Acme Studio/);
  assert.match(html, /CONTENT CREATOR|Content Creator/);
  const xlsx = fs.readFileSync(report.xlsx);
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK');
});
