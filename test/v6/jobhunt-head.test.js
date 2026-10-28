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
import { askHead, parseHeadResponse, readAiLog, readAiActive } from '../../src/v6/jobhunt/ai.js';
import { runJobHunt } from '../../src/v6/jobhunt/runner.js';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobhunt-head-'));
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
  return {
    home, log, queue, jobs,
    ctx: { home, log, queue, jobs, workersDir: path.join(home, 'workers'), reportsDir: path.join(home, 'reports'), hunter: { profile: () => ({ ok: true, profile }) } },
  };
}

test('the head prompt parser accepts fenced JSON and rejects submit tasks', () => {
  const parsed = parseHeadResponse('```json\n{"message":"Hej","strategy":"Bredda","tasks":[{"kind":"job.discover","query":"social media"},{"kind":"job.submit","applicationId":"app_x"}]}\n```');
  assert.equal(parsed.message, 'Hej');
  assert.equal(parsed.tasks.length, 2);
  assert.equal(parsed.validJson, true);
});

test('a real AI invocation is recorded with provider, model, invocation and message fields', async (t) => {
  const { home } = fixture(t);
  const session = { id: 'jh_test', round: 0, candidateId: 'lavinia', counts: {}, deadlineAt: new Date(Date.now() + 60000).toISOString() };
  const result = await askHead({
    home,
    mission: { id: 'jh_test', kind: 'jobhunt', goal: 'Sök jobb', deadlineAt: session.deadlineAt },
    session,
    queue: { byState: { QUEUED: 0 } },
    jobs: [],
    runRound: async () => ({
      ok: true,
      sessionId: 'ses_real_shape',
      text: '{"message":"Jag börjar med en bred sökning.","strategy":"Sök content och social media","tasks":[{"kind":"job.discover","query":"content creator","limit":50},{"kind":"job.submit","applicationId":"app_forbidden"}]}',
      events: [{ type: 'step_finish', part: { tokens: { total: 12 } } }],
    }),
  });
  assert.equal(result.ok, true);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].kind, 'job.discover');
  assert.equal(result.tasks[0].query, 'content creator');
  assert.equal(readAiActive(home), null);
  const log = readAiLog(home);
  assert.equal(log.length, 1);
  assert.equal(log[0].provider, 'opencode-go');
  assert.equal(log[0].exactModelId, 'opencode-go/deepseek-v4.1-flash');
  assert.equal(log[0].opencodeSessionId, 'ses_real_shape');
  assert.equal(log[0].messageText, 'Jag börjar med en bred sökning.');
  assert.ok(log[0].invocationId);
});

test('empty queue recovery asks the head again and keeps the mission alive to the deadline', async (t) => {
  const { ctx, queue, log } = fixture(t);
  let now = Date.parse('2026-10-27T10:00:00.000Z');
  queue.clock = () => now;
  const session = new JobHuntSession({ home: ctx.home, clock: () => now });
  await session.start({ durationMs: 120 * 60 * 1000, candidateId: 'lavinia', queries: ['x'], now });
  await session.checkpoint({ round: 1 }, { now });
  let headCalls = 0;
  let tasks = 0;
  const head = async () => {
    headCalls += 1;
    return { invocationId: `ai_${headCalls}`, messageText: `AI-runda ${headCalls}`, tasks: [{ kind: 'job.discover', query: `query ${headCalls}`, limit: 50 }] };
  };
  const supervisorFactory = () => new Supervisor({
    queue, log,
    handlers: {
      'job.discover': async () => {
        tasks += 1;
        now += 30 * 60 * 1000;
        return { ok: true, summary: `head task ${tasks}` };
      },
    },
    workerId: 'head-test',
    heartbeatFile: path.join(ctx.workersDir, 'head-test.json'),
    stopFile: session.stopFile,
    clock: () => now,
    limits: { maxTasks: 1, maxRuntimeMs: 5 * 60 * 1000, taskTimeoutMs: 5 * 60 * 1000, stallMs: 5000, pollMs: 10 },
  });
  const result = await runJobHunt({
    ctx, session, head, headBackoffMs: 0, maxAiCalls: 20, maxBatch: 1,
    clock: () => now,
    sleepFn: async (ms) => { now += Math.min(ms, 1000); },
    replanMs: 1000,
    supervisorFactory,
    writeReportFn: async () => ({ html: 'h', xlsx: 'x' }),
  });
  assert.equal(result.status, 'EXPIRED');
  assert.equal(tasks, 4, 'four head-created tasks ran across four batches');
  assert.ok(headCalls >= 4, 'the head was invoked again after empty queues');
  assert.equal((await session.read()).status, 'EXPIRED');
});
