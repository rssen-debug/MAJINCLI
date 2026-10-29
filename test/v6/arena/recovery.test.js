/**
 * Crash recovery and double-submission protection, with real processes.
 *
 * A worker is SIGKILLed while the employer endpoint is holding the request
 * open — the worst moment for an irreversible action. The test then proves:
 *   1. exactly one submission ever left the machine,
 *   2. the crashed task is recovered as UNCERTAIN (never as success),
 *   3. the external effect is marked uncertain, so a restarted worker cannot
 *      send a second application,
 *   4. the queue's own retry path refuses the uncertain task.
 *
 * The employer is a controlled loopback endpoint; this proves the machinery,
 * not that a real company received anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startControlledStack } from './controlled-server.mjs';
import { openV6 } from '../../../src/v6/home.js';
import { TaskQueue } from '../../../src/v6/queue.js';
import { EventLog } from '../../../src/v6/events.js';
import { transitionApplication } from '../../../src/v6/jobs/state.js';
import { POLICY_SCHEMA } from '../../../src/v6/arena/envelope.js';
import { PORTAL_SCHEMA } from '../../../src/v6/jobs/portal.js';

const run = promisify(execFile);
const BIN = path.resolve('bin/majin-v6.mjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 20000, stepMs = 50, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(stepMs);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function buildFixture(t, server) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v6Home = path.join(root, 'v6');
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(root, 'v5');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'owner-mode.json'), JSON.stringify({
    schema: 'majin.v4.owner-mode/v1', version: 1, lanes: ['files'], folders: [workspace], browserOrigins: [], history: [],
  }));

  const ctx = openV6({ home: v6Home });
  const paths = { root: path.join(v6Home, 'arena') };
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });

  const cvPath = path.join(root, 'cv.pdf');
  fs.writeFileSync(cvPath, '%PDF-1.4\nrecovery test cv\n');
  const profilesFile = path.join(root, 'profiles.json');
  fs.writeFileSync(profilesFile, JSON.stringify({
    schema: 'majin.v6.profiles/v1',
    candidates: [{
      id: 'it-candidate', displayName: 'Test Candidate', cvPath,
      contactEmail: 'candidate@example.test', gmailAccount: 'candidate@example.test',
      exclusions: { companies: [], roles: [], locations: [] },
      rules: { locationsAllow: [], minScore: 0.1 },
      approval: { policy: 'allow-list', authorizedCompanies: ['Acme'] },
      quotas: { maxPerDay: 5 },
    }],
  }));

  const adaptersFile = path.join(root, 'adapters.json');
  fs.writeFileSync(adaptersFile, JSON.stringify({
    schema: PORTAL_SCHEMA,
    adapters: [{
      id: 'controlled-ats', type: 'http-post',
      url: `${server.url}/apply`, allowedOrigins: [server.url], allowInsecureLocalhost: true,
      fieldMap: { name: '{{candidate.displayName}}', email: '{{candidate.contactEmail}}', jobId: '{{job.siteId}}' },
      cvField: 'cv',
      ack: { statusInList: [200], bodyContainsAny: ['received'], referenceRegex: 'Reference:\\s*([A-Z0-9-]+)' },
    }],
  }));

  fs.writeFileSync(path.join(paths.root, 'policy.json'), JSON.stringify({
    schema: POLICY_SCHEMA,
    keyId: 'ark_recovery',
    allowedKinds: ['tool', 'job.submit'],
    allowedTools: [],
    allowIrreversible: true,
    relay: { type: 'http', url: server.url },
    submission: { adaptersFile, adapterId: 'controlled-ats' },
    profilesFile,
  }));
  return { root, v6Home, workspace, dataDir, ctx, profilesFile, adaptersFile };
}

async function approvedApplication(ctx, server) {
  const { application } = await ctx.jobs.upsertDiscovered({
    site: 'controlled',
    siteId: 'job-77',
    title: 'Frontend Developer',
    company: 'Acme AB',
    city: 'Stockholm',
    url: 'https://acme.example/jobs/77',
    apply: { url: 'https://acme.example/jobs/77/apply' },
    description: 'JavaScript React Node.js',
    mustHave: ['JavaScript'],
  }, 'it-candidate');
  // Fixture state: the application is already matched and owner-approved, so the
  // test starts at the irreversible step instead of replaying discovery.
  transitionApplication(application, 'MATCHED', { by: 'test', evidence: { score: 0.9 } });
  transitionApplication(application, 'APPROVED', { by: 'test', evidence: { approvalRef: 'owner-allow-list/Acme' } });
  await ctx.jobs.save(application, { event: 'approved-for-recovery-test' });
  return application;
}

test('a worker killed mid-submission never causes a second application', { timeout: 120000 }, async (t) => {
  const server = await startControlledStack({ applyHang: true });
  t.after(() => server.close());
  const fixture = buildFixture(t, server);
  const application = await approvedApplication(fixture.ctx, server);

  const queued = await fixture.ctx.queue.add({
    kind: 'job.submit',
    title: 'recovery test submission',
    payload: { applicationId: application.id },
    irreversible: true,
    effectKey: `application:${application.id}`,
    maxAttempts: 1,
    dedupeKey: `submit:${application.id}`,
  });

  const child = spawn(process.execPath, [
    BIN, 'worker', '--once', '--max-tasks', '1', '--max-runtime-ms', '30000',
    '--v6-home', fixture.v6Home, '--workspace', fixture.workspace, '--data-dir', fixture.dataDir,
    '--worker-id', 'recovery-w1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });

  // The submission is on the wire and the portal is holding the response.
  await waitFor(() => server.stats.hungRequests === 1, { label: 'the held submission' })
    .catch((error) => {
      throw new Error(`${error.message}\nworker stdout: ${stdout.slice(0, 1500)}\nworker stderr: ${stderr.slice(0, 1500)}`);
    });
  assert.equal(server.stats.submissions, 1, 'exactly one POST left the worker before the crash');

  // Kill -9 at the worst possible moment: no cleanup, no receipt.
  const killed = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.kill('SIGKILL');
  const exit = await killed;
  assert.equal(exit.signal, 'SIGKILL', `worker did not die from SIGKILL: ${JSON.stringify(exit)} ${stderr.slice(0, 300)}`);

  // The task is still RUNNING with a lease held by a dead process.
  const running = await fixture.ctx.queue.get(queued.task.id);
  assert.equal(running.state, 'RUNNING');
  assert.ok(running.lease?.workerId, 'the crashed worker still owns the lease');
  const duringCrash = await fixture.ctx.jobs.get(application.id);
  assert.notEqual(duringCrash.state, 'SUBMITTED_UNCONFIRMED', 'a killed worker must not leave a submitted state behind');

  // Real recovery, using the real queue code with an advanced clock: the lease
  // has expired because the process that held it is gone.
  const later = new EventLog(path.join(fixture.v6Home, 'events'));
  const recoveredQueue = new TaskQueue({
    file: path.join(fixture.v6Home, 'queue', 'queue.json'),
    log: later,
    clock: () => Date.now() + 15 * 60 * 1000,
  });
  const recovered = await recoveredQueue.recoverExpired();
  assert.ok(recovered.some((entry) => entry.id === queued.task.id), 'the crashed task was recovered');

  const afterRecovery = await fixture.ctx.queue.get(queued.task.id);
  assert.equal(afterRecovery.state, 'UNCERTAIN', 'an irreversible crash is UNCERTAIN, never COMPLETED');
  assert.equal(afterRecovery.blocked?.code, 'WORKER_LOST_IRREVERSIBLE');
  assert.equal(afterRecovery.blocked?.requiresOwner, true);
  const state = JSON.parse(fs.readFileSync(path.join(fixture.v6Home, 'queue', 'queue.json'), 'utf8'));
  assert.equal(state.effects[`application:${application.id}`].state, 'uncertain', 'the external effect is marked uncertain');

  // A restarted worker must not send anything again.
  const second = await run(process.execPath, [
    BIN, 'worker', '--once', '--max-tasks', '3', '--max-runtime-ms', '20000',
    '--v6-home', fixture.v6Home, '--workspace', fixture.workspace, '--data-dir', fixture.dataDir,
    '--worker-id', 'recovery-w2',
  ], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
  const summary = JSON.parse(second.stdout.trim().split('\n').at(-1));
  assert.equal(summary.executed, 0, `a restarted worker must not execute the uncertain task: ${second.stdout}`);
  assert.equal(server.stats.submissions, 1, 'no second application was ever sent');
  assert.equal(server.stats.hungRequests, 1);

  // The queue's own requeue path refuses to convert uncertainty into a retry.
  let retryRefused = null;
  try {
    await recoveredQueue.requeue(queued.task.id);
  } catch (error) {
    retryRefused = error;
  }
  assert.ok(retryRefused, 'requeue must refuse an UNCERTAIN irreversible task');
  assert.equal(retryRefused.code, 'TASK_UNCERTAIN_RETRY_REFUSED');

  // Reconciling with evidence is the only way forward, and it does not resend.
  const reconciled = await recoveredQueue.resolveUncertain(queued.task.id, {
    outcome: 'failed_final',
    evidence: { note: 'employer endpoint never answered; verified manually in the portal' },
  });
  assert.equal(reconciled.state, 'FAILED_FINAL');
  assert.equal(server.stats.submissions, 1, 'reconciliation never triggers a new submission');

  const finalApplication = await fixture.ctx.jobs.get(application.id);
  assert.notEqual(finalApplication.state, 'SUBMITTED_UNCONFIRMED', 'the application was never marked submitted');
  const evidenceDir = path.join(fixture.v6Home, 'arena', 'evidence');
  const evidenceFiles = fs.existsSync(evidenceDir) ? fs.readdirSync(evidenceDir) : [];
  assert.equal(evidenceFiles.length, 0, 'no receipt was invented for the killed submission');
});
