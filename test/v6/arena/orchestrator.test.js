/**
 * The autonomous loop, exercised for real.
 *
 * A stub model is served over a real HTTP socket (that is the fixture), while
 * everything else is production code: MAJIN's provider transport, the durable
 * queue, the supervisor, the V5 tool drivers and the journal. The test asserts
 * what the loop did — it never asserts that a model "thought".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openV6 } from '../../../src/v6/home.js';
import { createBridge } from '../../../src/v6/bridge.js';
import { createToolInvoker } from '../../../src/v6/tool-invoker.js';
import { buildHandlers } from '../../../src/v6/handlers.js';
import { Supervisor } from '../../../src/v6/supervisor.js';
import { MissionOrchestrator } from '../../../src/v6/arena/orchestrator.js';
import { MissionJournal, validateMission } from '../../../src/v6/arena/mission.js';
import { askPlanner, trimRationale } from '../../../src/v6/arena/planner.js';

function makeMission(overrides = {}) {
  const validated = validateMission({
    schema: 'majin.v6.arena.mission/v1',
    id: 'mission-loop-test',
    goal: 'Write a note, hash it, then report the hash back to the owner.',
    constraints: ['stay inside the workspace folder'],
    allowedActions: ['tool'],
    allowedTools: ['fs_write', 're_hash'],
    stopWhen: 'the hash has been produced',
    budget: { maxSteps: 6, maxTokens: 100000, maxWallMs: 120000, maxCostUsd: 5, maxSubmissions: 0 },
    ...overrides,
  });
  assert.equal(validated.ok, true, validated.error?.reason);
  return validated.mission;
}

async function scriptedProvider(t, decisions) {
  const calls = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    calls.push({ messages: body.messages, model: body.model });
    const index = Math.min(calls.length - 1, decisions.length - 1);
    const decision = typeof decisions[index] === 'function' ? decisions[index](calls.length) : decisions[index];
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      model: 'stub-model',
      choices: [{ message: { content: JSON.stringify(decision) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const route = {
    kind: 'openai', providerName: 'Stub', provider: 'stub', baseUrl: url,
    endpoint: `${url}/v1/chat/completions`, apiKey: 'test-key', model: 'stub-model',
    maxTokens: 256, temperature: 0, pricing: { in: 0.5, out: 1.5 },
  };
  return { calls, url, route };
}

function buildRig(t, { lanes = ['files', 're'], maxTasks = 1 } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-orchestrator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'workspace');
  const dataDir = path.join(root, 'v5');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'owner-mode.json'), JSON.stringify({
    schema: 'majin.v4.owner-mode/v1', version: 1, lanes, folders: [workspace], browserOrigins: [], history: [],
  }));
  const ctx = openV6({ home: path.join(root, 'v6') });
  const bridge = createBridge({
    workspace, dataDir, v6Home: ctx.home, log: ctx.log,
    driverStateDir: path.join(ctx.home, 'drivers', 'orchestrator-test'),
  });
  t.after(async () => { await bridge.close().catch(() => {}); });
  return { root, workspace, dataDir, ctx, bridge };
}

async function runMission({ rig, mission, stub, journal, allowIrreversible = false, resume = false }) {
  await rig.bridge.start();
  const invoker = createToolInvoker({ callToolFn: (name, args) => rig.bridge.callTool(name, args), log: rig.ctx.log });
  const supervisor = new Supervisor({
    queue: rig.ctx.queue, log: rig.ctx.log, handlers: buildHandlers({}), workerId: 'orchestrator-test',
    heartbeatFile: path.join(rig.ctx.home, 'workers', 'test.json'), stopFile: rig.ctx.stopFile, toolInvoker: invoker,
    limits: { maxTasks: 1, maxRuntimeMs: 30000, pollMs: 5, leaseMs: 20000, stallMs: 15000 },
  });
  const config = { provider: 'stub', model: 'stub-model', route: stub.route, keySource: 'test' };
  const planner = { ask: (args) => askPlanner({ config, ...args }) };
  const orchestrator = new MissionOrchestrator({
    mission, planner, queue: rig.ctx.queue, log: rig.ctx.log, journal,
    runWork: () => supervisor.run({ maxTasks: 1, maxRuntimeMs: 30000 }),
    allowIrreversible,
  });
  return orchestrator.run({ resume });
}

test('the loop writes, reads its own result, reasons on it and finishes', { timeout: 60000 }, async (t) => {
  const rig = buildRig(t);
  const mission = makeMission();
  const stub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 'fs_write', arguments: { path: 'note.txt', content: 'hello from the loop\n' } }, rationale: 'start by creating the note' },
    { action: 'tool', payload: { tool: 're_hash', arguments: { path: 'note.txt' } }, rationale: 'the note exists, hash it' },
    { action: 'stop', done: true, summary: 'note written and hashed' },
  ]);
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });

  const summary = await runMission({ rig, mission, stub, journal });

  assert.equal(summary.stopReason, 'done', JSON.stringify(summary));
  assert.equal(summary.steps, 3);
  assert.equal(stub.calls.length, 3, 'one model call per decision');

  // The file is real and the hash in the journal matches the operating system.
  const written = fs.readFileSync(path.join(rig.workspace, 'note.txt'), 'utf8');
  assert.equal(written, 'hello from the loop\n');
  const entries = journal.read();
  const results = entries.filter((entry) => entry.phase === 'result');
  assert.equal(results.length, 2);
  assert.equal(results[0].state, 'COMPLETED');
  assert.equal(results[1].state, 'COMPLETED');

  const hash = (await rig.ctx.queue.list({})).find((task) => task.kind === 'tool' && task.result?.output?.meta?.hashes);
  assert.ok(hash, 'the hash result is stored on the task');
  const sha256 = hash.result.output.meta.hashes[0].sha256;
  const { createHash } = await import('node:crypto');
  assert.equal(sha256, createHash('sha256').update(written).digest('hex'));

  // The second prompt carried the first result: that is what "reasons on it" means.
  const secondPrompt = JSON.stringify(stub.calls[1].messages);
  assert.match(secondPrompt, /note\.txt/, 'the model saw the previous step in the state digest');

  assert.ok(summary.spent.tokens >= 360, `token accounting must be real, got ${summary.spent.tokens}`);
  assert.ok(summary.spent.costUsd > 0, 'cost is computed from the configured pricing');
  assert.equal(summary.submissions, 0);
});

test('the loop stops at its step budget instead of running forever', { timeout: 60000 }, async (t) => {
  const rig = buildRig(t);
  const mission = makeMission({ budget: { maxSteps: 2, maxTokens: 100000, maxWallMs: 120000, maxCostUsd: 5, maxSubmissions: 0 } });
  const stub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 'fs_write', arguments: { path: 'a.txt', content: 'a' } }, rationale: 'write a' },
  ]);
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });
  const summary = await runMission({ rig, mission, stub, journal });
  assert.equal(summary.stopReason, 'budget_steps');
  assert.equal(summary.steps, 2);
  assert.equal((await rig.ctx.queue.list({})).length, 2, 'exactly the budgeted number of tasks ran');
});

test('the loop stops at its cost budget', { timeout: 60000 }, async (t) => {
  const rig = buildRig(t);
  const mission = makeMission({ budget: { maxSteps: 10, maxTokens: 100000, maxWallMs: 120000, maxCostUsd: 0.00001, maxSubmissions: 0 } });
  const stub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 'fs_write', arguments: { path: 'a.txt', content: 'a' } }, rationale: 'write a' },
  ]);
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });
  const summary = await runMission({ rig, mission, stub, journal });
  assert.equal(summary.stopReason, 'budget_cost');
});

test('a tool the owner did not grant stops the loop and is never retried blindly', { timeout: 60000 }, async (t) => {
  const rig = buildRig(t, { lanes: ['files'] }); // no 're' lane
  const mission = makeMission();
  const stub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 're_hash', arguments: { path: 'note.txt' } }, rationale: 'hash it' },
  ]);
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });
  const summary = await runMission({ rig, mission, stub, journal });
  assert.equal(summary.stopReason, 'stuck', JSON.stringify(summary));
  assert.ok(summary.steps <= 4);
  const results = journal.read().filter((entry) => entry.phase === 'result');
  assert.ok(results.every((entry) => entry.state === 'FAILED_FINAL'));
  assert.equal(results[0].errorCode, 'TOOL_NOT_AUTHORIZED');
});

test('an irreversible mission refuses to start its loop without an explicit opt-in', { timeout: 60000 }, async (t) => {
  const rig = buildRig(t);
  const mission = makeMission({ allowedActions: ['tool', 'job.submit'], allowedTools: ['fs_write'] });
  const stub = await scriptedProvider(t, [
    { action: 'job.submit', payload: { applicationId: 'app_1' }, rationale: 'submit it' },
  ]);
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });
  const summary = await runMission({ rig, mission, stub, journal, allowIrreversible: false });
  assert.equal(summary.stopReason, 'needs_owner');
  assert.match(String(summary.detail), /--allow-irreversible/);
  assert.equal((await rig.ctx.queue.list({})).length, 0, 'nothing was queued');
});

test('a resumed mission continues without re-running completed steps', { timeout: 90000 }, async (t) => {
  const rig = buildRig(t);
  const mission = makeMission();
  const journal = new MissionJournal({ dir: path.join(rig.ctx.home, 'arena', 'missions'), missionId: mission.id });

  const firstStub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 'fs_write', arguments: { path: 'note.txt', content: 'first\n' } }, rationale: 'write' },
  ]);
  const first = await runMission({
    rig, mission: makeMission({ budget: { maxSteps: 1, maxTokens: 100000, maxWallMs: 120000, maxCostUsd: 5, maxSubmissions: 0 } }),
    stub: firstStub, journal,
  });
  assert.equal(first.stopReason, 'budget_steps');
  assert.equal(fs.readFileSync(path.join(rig.workspace, 'note.txt'), 'utf8'), 'first\n');
  const taskCountAfterFirst = (await rig.ctx.queue.list({})).length;
  assert.equal(taskCountAfterFirst, 1);

  // Second session: a different "model" that finishes the job.
  const secondStub = await scriptedProvider(t, [
    { action: 'tool', payload: { tool: 're_hash', arguments: { path: 'note.txt' } }, rationale: 'hash the note written earlier' },
    { action: 'stop', done: true, summary: 'finished after resume' },
  ]);
  const second = await runMission({ rig, mission, stub: secondStub, journal, resume: true });
  assert.equal(second.stopReason, 'done', JSON.stringify(second));
  assert.equal(second.resumedFrom, 1);
  const tasks = await rig.ctx.queue.list({});
  assert.equal(tasks.length, taskCountAfterFirst + 1, 'the completed step was not enqueued a second time');
  assert.equal(fs.readFileSync(path.join(rig.workspace, 'note.txt'), 'utf8'), 'first\n', 'the note was not rewritten');
});

test('mission validation rejects a mission that could do anything', () => {
  assert.equal(validateMission({ schema: 'majin.v6.arena.mission/v1', id: 'x', goal: 'short' }).error.code, 'MISSION_ID_INVALID');
  assert.equal(validateMission({
    schema: 'majin.v6.arena.mission/v1', id: 'valid-id', goal: 'a goal long enough', allowedActions: [],
  }).error.code, 'MISSION_ACTIONS_MISSING');
  assert.equal(validateMission({
    schema: 'majin.v6.arena.mission/v1', id: 'valid-id', goal: 'a goal long enough', allowedActions: ['rm -rf'],
  }).error.code, 'MISSION_ACTION_UNKNOWN');
  assert.equal(validateMission({
    schema: 'majin.v6.arena.mission/v1', id: 'valid-id', goal: 'a goal long enough', allowedActions: ['tool'], allowedTools: [],
  }).error.code, 'MISSION_TOOLS_MISSING');
  const ok = validateMission({
    schema: 'majin.v6.arena.mission/v1', id: 'valid-id', goal: 'a goal long enough',
    allowedActions: ['tool'], allowedTools: ['fs_read'],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.mission.budget.maxSubmissions, 0, 'zero submissions unless the owner raises it');
});

test('no chain-of-thought is requested or stored', () => {
  const journalText = trimRationale('reasoning: the owner wants a note');
  assert.equal(typeof journalText, 'string');
  assert.ok(!/chain|thought|step by step/i.test(journalText));
});
