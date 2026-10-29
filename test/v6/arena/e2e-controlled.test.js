/**
 * Controlled end-to-end: Arena-style planning -> signed envelope -> real relay
 * (HTTP) -> durable queue -> supervisor -> real job pipeline -> real HTTP
 * submission -> acknowledgement -> Gmail-shaped confirmation.
 *
 * The employer and mailbox are controlled loopback endpoints. This proves the
 * machinery end to end; it does NOT prove that a real company received an
 * application. See docs/v6/ARENA_BRIDGE.md.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startControlledStack, RELAY_TOKEN } from './controlled-server.mjs';
import { openV6 } from '../../../src/v6/home.js';
import { createArenaPaths, ArenaAgent, loadArenaPolicy } from '../../../src/v6/arena/agent.js';
import { signEnvelope, createSecret, POLICY_SCHEMA } from '../../../src/v6/arena/envelope.js';
import { HttpRelay } from '../../../src/v6/arena/relay.js';
import { loadProfiles } from '../../../src/v6/jobs/store.js';
import { JobHunter } from '../../../src/v6/jobs/hunter.js';
import { loadPortalAdapters, createPortalSubmitAdapter, PORTAL_SCHEMA } from '../../../src/v6/jobs/portal.js';
import { GmailClient } from '../../../src/v6/gmail.js';
import { buildHandlers } from '../../../src/v6/handlers.js';
import { Supervisor } from '../../../src/v6/supervisor.js';

async function buildStack(t, stackOptions = {}) {
  const server = await startControlledStack(stackOptions);
  t.after(() => server.close());

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-e2e-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ctx = openV6({ home: path.join(root, 'v6') });
  const paths = createArenaPaths(ctx.home);
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });

  const cvPath = path.join(root, 'cv-it.pdf');
  fs.writeFileSync(cvPath, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('fake cv for controlled e2e\n')]));
  const profilesFile = path.join(root, 'profiles.json');
  fs.writeFileSync(profilesFile, JSON.stringify({
    schema: 'majin.v6.profiles/v1',
    candidates: [{
      id: 'it-candidate', displayName: 'Test Candidate', cvPath,
      contactEmail: 'candidate@example.test', gmailAccount: 'candidate@example.test',
      exclusions: { companies: ['Atea', 'Gigstep', 'Poolia'], roles: [], locations: [] },
      rules: { locationsAllow: [], minScore: 0.2 },
      approval: { policy: 'allow-list', authorizedCompanies: ['Acme'] },
      quotas: { maxPerDay: 5 },
    }],
  }));

  const adaptersFile = path.join(root, 'adapters.json');
  fs.writeFileSync(adaptersFile, JSON.stringify({
    schema: PORTAL_SCHEMA,
    adapters: [{
      id: 'controlled-ats',
      type: 'http-post',
      url: `${server.url}/apply`,
      allowedOrigins: [server.url],
      allowInsecureLocalhost: true,
      fieldMap: {
        name: '{{candidate.displayName}}',
        email: '{{candidate.contactEmail}}',
        jobId: '{{job.siteId}}',
      },
      cvField: 'cv',
      ack: { statusInList: [200], bodyContainsAny: ['received'], referenceRegex: 'Reference:\\s*([A-Z0-9-]+)' },
    }],
  }));

  const secret = createSecret();
  const policyFile = paths.policy;
  fs.writeFileSync(policyFile, JSON.stringify({
    schema: POLICY_SCHEMA,
    keyId: 'ark_e2e',
    allowedKinds: ['tool', 'job.discover', 'job.evaluate', 'job.submit', 'gmail.verify'],
    allowedTools: ['fs_read'],
    allowIrreversible: true,
    relay: { type: 'http', url: server.url },
    submission: { adaptersFile, adapterId: 'controlled-ats' },
    profilesFile,
    server: { port: 0 },
  }));
  fs.writeFileSync(paths.secret, secret, { mode: 0o600 });

  const loadedPolicy = loadArenaPolicy(policyFile);
  assert.equal(loadedPolicy.ok, true, loadedPolicy.error?.reason);
  const policy = loadedPolicy.policy;

  const profiles = loadProfiles(profilesFile);
  assert.equal(profiles.ok, true);
  const gmail = new GmailClient({
    credentials: {
      clientId: 'controlled', clientSecret: 'controlled', refreshToken: 'controlled',
      account: 'candidate@example.test',
    },
    apiBase: `${server.url}/gmail/v1/users/me`,
    tokenUrl: `${server.url}/token`,
    log: ctx.log,
  });
  const hunter = new JobHunter({
    store: ctx.jobs, profiles, log: ctx.log, gmail,
    searchFn: async ({ q, limit }) => {
      const response = await fetch(`${server.url}/feed?q=${encodeURIComponent(q)}&limit=${limit}`);
      return response.json();
    },
    // The CV text used for scoring is a fixture; the portal adapter still
    // uploads the real file from disk.
    cvReader: async () => 'JavaScript React Node.js TypeScript',
  });

  const adapters = loadPortalAdapters(adaptersFile);
  assert.equal(adapters.ok, true, adapters.error?.reason);
  const submitAdapter = createPortalSubmitAdapter({
    adapters: adapters.adapters, adapterId: 'controlled-ats', hunter,
    evidenceDir: paths.evidence, log: ctx.log,
  });

  const supervisor = new Supervisor({
    queue: ctx.queue, log: ctx.log,
    handlers: buildHandlers({ hunter, submitAdapter }),
    workerId: 'arena-e2e',
    heartbeatFile: path.join(ctx.workersDir, 'arena-e2e.json'),
    stopFile: ctx.stopFile,
    limits: { maxTasks: 6, maxRuntimeMs: 20000, stallMs: 5000, pollMs: 10, leaseMs: 30000 },
  });
  const relay = new HttpRelay({ baseUrl: server.url, token: RELAY_TOKEN });
  const agent = new ArenaAgent({
    relay, secret, policy, queue: ctx.queue, log: ctx.log,
    ledgerFile: paths.ledger, workerId: 'arena-e2e',
    runWork: ({ maxTasks }) => supervisor.run({ maxTasks, maxRuntimeMs: 20000 }),
  });

  async function plan(task) {
    const envelope = signEnvelope({
      secret, keyId: policy.keyId, task,
      policy: { allowTools: task.kind === 'tool' ? [task.payload.tool] : [] },
    });
    const response = await fetch(`${server.url}/relay/inbox/${envelope.id}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
    });
    assert.equal(response.status, 201);
    return envelope;
  }

  return { server, ctx, paths, policy, secret, hunter, relay, agent, plan, adaptersFile, profilesFile };
}

test('a planned job goes from discovery to a confirmed application with real evidence', { timeout: 90000 }, async (t) => {
  const { server, ctx, paths, hunter, agent, plan } = await buildStack(t);

  // 1. Arena plans discovery.
  const discoverEnvelope = await plan({
    kind: 'job.discover',
    title: 'find frontend roles',
    payload: { candidateId: 'it-candidate', query: 'frontend', limit: 10 },
  });
  let summary = await agent.pollOnce();
  assert.equal(summary.accepted, 1);
  assert.deepEqual(summary.refused, []);
  assert.equal(server.inbox.size, 0, 'the relay item is consumed after acknowledgement');

  const applications = await ctx.jobs.list({ candidateId: 'it-candidate' });
  assert.equal(applications.length, 1, 'the excluded employer is never stored');
  const application = applications[0];
  assert.equal(application.job.company, 'Acme AB');

  // 2. Arena plans matching.
  await plan({ kind: 'job.evaluate', payload: { applicationId: application.id } });
  await agent.pollOnce();
  let stored = await ctx.jobs.get(application.id);
  assert.equal(stored.state, 'APPROVED', 'owner allow-list policy approved Acme');
  assert.ok(stored.score >= 0.2);

  // 3. Arena requests the submission; the owner policy allows it.
  const submitEnvelope = await plan({
    kind: 'job.submit',
    irreversible: true,
    payload: { applicationId: application.id },
  });
  await agent.pollOnce();
  assert.equal(server.stats.submissions, 1, 'exactly one HTTP submission was sent');
  const body = server.stats.submissionBodies[0];
  assert.equal(body.hasCv, true, 'the CV file was attached');
  assert.equal(body.hasName, true);
  assert.equal(body.hasEmail, true);

  stored = await ctx.jobs.get(application.id);
  assert.equal(stored.state, 'SUBMITTED_UNCONFIRMED');
  const evidenceFiles = fs.readdirSync(paths.evidence);
  assert.equal(evidenceFiles.length, 1, 'the acknowledgement was stored as local evidence');
  const evidence = JSON.parse(fs.readFileSync(path.join(paths.evidence, evidenceFiles[0]), 'utf8'));
  assert.equal(evidence.status, 200);
  assert.equal(evidence.applicationId, application.id);
  assert.equal(evidence.bodyPreview.includes('received'), true);

  // 4. Arena asks for email verification; the read-only client confirms.
  await plan({ kind: 'gmail.verify', payload: { applicationId: application.id } });
  await agent.pollOnce();
  stored = await ctx.jobs.get(application.id);
  assert.equal(stored.state, 'CONFIRMED_RECEIVED', 'the confirmation email advanced the state');
  assert.ok(server.stats.gmailSearches >= 1);

  // 5. Results are published back to the planner, sanitized.
  const published = server.stats.outbox.get(discoverEnvelope.id);
  assert.ok(published, 'the discovery result was published');
  assert.equal(published.schema, 'majin.v6.arena.result/v1');
  assert.equal(published.state, 'COMPLETED');
  const submitResult = server.stats.outbox.get(submitEnvelope.id);
  assert.equal(submitResult.state, 'COMPLETED');
  assert.equal(submitResult.receipt.reference, 'ACME-2026-0042');
  assert.ok(!JSON.stringify([...server.stats.outbox.values()]).includes('candidate@example.test'), 'no email address is published');

  // 6. The same envelope cannot be executed twice.
  await fetch(`${server.url}/relay/inbox/${submitEnvelope.id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(submitEnvelope),
  });
  const replay = await agent.pollOnce();
  assert.equal(replay.accepted, 0);
  assert.ok(replay.refused.some((entry) => entry.code === 'ARENA_REPLAY'));
  assert.equal(server.stats.submissions, 1, 'a replay never sends a second application');
});

test('a portal that answers without an acknowledgement yields UNCERTAIN, never success', { timeout: 90000 }, async (t) => {
  const { server, ctx, plan, agent } = await buildStack(t, {
    ackText: 'Server busy. Please try again later.',
  });
  await plan({ kind: 'job.discover', payload: { candidateId: 'it-candidate', query: 'frontend', limit: 10 } });
  await agent.pollOnce();
  const [application] = await ctx.jobs.list({ candidateId: 'it-candidate' });
  await plan({ kind: 'job.evaluate', payload: { applicationId: application.id } });
  await agent.pollOnce();
  await plan({ kind: 'job.submit', irreversible: true, payload: { applicationId: application.id } });
  await agent.pollOnce();

  assert.equal(server.stats.submissions, 1);
  const stored = await ctx.jobs.get(application.id);
  assert.equal(stored.state, 'FORM_PREPARED', 'an unacknowledged answer must not advance the application');
  const tasks = await ctx.queue.list({ kind: 'job.submit' });
  assert.equal(tasks.at(-1).state, 'UNCERTAIN');
  assert.equal(tasks.at(-1).blocked.requiresOwner, true);
});

test('a tampered or foreign envelope is refused before any work happens', { timeout: 60000 }, async (t) => {
  const { server, ctx, agent, policy, secret } = await buildStack(t);
  // Sign locally, tamper, then publish only the tampered copy.
  const original = signEnvelope({
    secret, keyId: policy.keyId,
    task: { kind: 'job.discover', payload: { candidateId: 'it-candidate', query: 'frontend' } },
  });
  const tampered = { ...original, payload: { candidateId: 'it-candidate', query: 'ceo' } };
  await fetch(`${server.url}/relay/inbox/tampered-1`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(tampered),
  });
  // Correctly signed, but by a different key.
  const foreign = signEnvelope({ secret: createSecret(), keyId: 'ark_foreign', task: { kind: 'job.discover', payload: { candidateId: 'x', query: 'y' } } });
  await fetch(`${server.url}/relay/inbox/${foreign.id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(foreign),
  });

  const summary = await agent.pollOnce();
  const codes = summary.refused.map((entry) => entry.code);
  assert.ok(codes.includes('ARENA_BAD_SIGNATURE'), `expected a signature refusal, got ${codes.join(',')}`);
  assert.ok(codes.includes('ARENA_UNKNOWN_KEY'), `expected a key refusal, got ${codes.join(',')}`);
  assert.equal((await ctx.jobs.list()).length, 0, 'no job work ran for refused envelopes');
  assert.equal(server.stats.submissions, 0);
  assert.equal(policy.keyId, 'ark_e2e');
  assert.ok(secret.length >= 32);
});

test('the CLI poller consumes relay work in a real subprocess', { timeout: 60000 }, async (t) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  const server = await startControlledStack({});
  t.after(() => server.close());
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-arena-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const paths = createArenaPaths(home);
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const secret = createSecret();
  fs.writeFileSync(paths.secret, secret, { mode: 0o600 });
  fs.writeFileSync(paths.policy, JSON.stringify({
    schema: POLICY_SCHEMA,
    keyId: 'ark_cli',
    allowedKinds: ['health.delay'],
    allowedTools: [],
    allowIrreversible: false,
    relay: { type: 'http', url: server.url },
  }));
  const tokenFile = path.join(home, 'relay-token');
  fs.writeFileSync(tokenFile, RELAY_TOKEN, { mode: 0o600 });

  const envelope = signEnvelope({ secret, keyId: 'ark_cli', task: { kind: 'health.delay', payload: { ms: 5 }, title: 'cli probe' } });
  await fetch(`${server.url}/relay/inbox/${envelope.id}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${RELAY_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  const result = await run(process.execPath, [
    path.resolve('bin/majin-v6.mjs'), 'arena', 'poll', '--once',
    '--v6-home', home, '--token-file', tokenFile, '--max-tasks', '2',
  ], { timeout: 45000, env: { ...process.env, MAJIN_V6_HOME: home } });

  const summary = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  assert.equal(summary.ok, true, result.stdout + result.stderr);
  assert.equal(summary.accepted, 1);
  assert.equal(summary.work.completed, 1);
  assert.equal(summary.published, 1);
  assert.equal(server.inbox.size, 0);
  const published = server.stats.outbox.get(envelope.id);
  assert.equal(published.state, 'COMPLETED');
  assert.equal(published.kind, 'health.delay');

  const second = await run(process.execPath, [
    path.resolve('bin/majin-v6.mjs'), 'arena', 'poll', '--once',
    '--v6-home', home, '--token-file', tokenFile,
  ], { timeout: 45000, env: { ...process.env, MAJIN_V6_HOME: home } });
  const secondSummary = JSON.parse(second.stdout.slice(second.stdout.indexOf('{')));
  assert.equal(secondSummary.accepted, 0, 'an empty inbox produces no work');
  assert.equal(secondSummary.work.executed, 0, 'completed work is never replayed');
});
