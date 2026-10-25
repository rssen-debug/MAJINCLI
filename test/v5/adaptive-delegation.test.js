import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GrandArchitect } from '../../src/v5/architect.js';
import { createDelegationTool } from '../../src/v5/adaptive-delegation.js';

const tasks = [
  { id: 'alpha', task: 'Read alpha.txt and report its observed content.' },
  { id: 'beta', task: 'Read beta.txt and report its observed content.' },
  { id: 'gamma', task: 'Read gamma.txt and report its observed content.' },
];
const reason = 'Each independent source can be read without any result from another worker.';

async function fixture(t, completeImpl) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-adaptive-delegation-'));
  const architect = new GrandArchitect({ dataDir: root, completeImpl });
  await architect.providers.configureProvider({ providerId: 'opencode-go', apiKey: 'local-test-key', discover: false });
  architect.providers.selectModel({ providerId: 'opencode-go', modelId: 'deepseek-v4-pro', allowManualFallback: true });
  architect.files.enableOwnerMode({ lanes: ['files', 'shell', 'browser'], folders: [architect.workspaceDir] });
  for (const name of ['alpha', 'beta', 'gamma']) fs.writeFileSync(path.join(architect.workspaceDir, `${name}.txt`), `${name}-independent-proof`);
  const goal = { goal_id: 'fixture-goal', cost: { modelCalls: 0, inputTokens: 0, outputTokens: 0 } };
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = (extra = {}) => ({ architect, goal, grantedLanes: architect.files.describeAccessState().grantedLanes,
    allowedFolders: architect.files.describeAccessState().grantedFolders, ...extra });
  return { root, architect, goal, options };
}

const sourceName = messages => /Read (\w+)\.txt/.exec(messages.find(message => message.role === 'user').content)[1];
const readCall = name => ({ content: '', toolCalls: [{ id: 'read', name: 'fs_read', args: { path: `${name}.txt` } }], usage: { input: 10, output: 5 } });

test('independent workers use real confined file tools, separate sessions and concurrency two; persisted completed observations resume without calls', async t => {
  let active = 0; let maxActive = 0; const sessions = new Set(); const sourceSessions = new Map(); const calls = [];
  const { root, goal, architect, options } = await fixture(t, async ({ messages, tools, provider }) => {
    active++; maxActive = Math.max(maxActive, active);
    const name = sourceName(messages);
    const session = provider.headers['x-opencode-session']; sessions.add(session);
    assert.equal(sourceSessions.get(name) || session, session); sourceSessions.set(name, session);
    assert.deepEqual(tools.map(tool => tool.name).sort(), ['documents_extract', 'fs_list', 'fs_read', 'fs_search']);
    calls.push(name);
    await new Promise(resolve => setTimeout(resolve, 30)); active--;
    const observation = messages.find(message => message.role === 'tool');
    if (!observation) return readCall(name);
    assert.match(observation.content, new RegExp(`${name}-independent-proof`));
    return { content: `Observed ${name}-independent-proof`, usage: { input: 20, output: 10, costUsd: 0.01 } };
  });
  const checkpointFile = path.join(root, 'goal-checkpoint.json');
  const tool = createDelegationTool(options({ onCheckpoint: () => fs.writeFileSync(checkpointFile, JSON.stringify(goal)) }));
  const result = await tool.run({ tasks, reason });
  assert.equal(result.status, 'COMPLETED'); assert.equal(result.verified, false); assert.equal(result.trusted, false);
  assert.equal(maxActive, 2); assert.equal(sessions.size, 3);
  assert.equal(goal.cost.modelCalls, 6); assert.equal(goal.cost.toolCalls, 3);
  assert.equal(goal.cost.inputTokens, 90); assert.equal(goal.cost.outputTokens, 45); assert.equal(goal.cost.reportedUsd, 0.03);
  assert.equal(goal.tool_results.length, 3);
  assert.deepEqual(goal.tool_results.map(row => row.delegatedTaskId).sort(), ['alpha', 'beta', 'gamma']);
  assert(goal.tool_results.every(row => row.delegated && row.status === 'completed' && row.argKeys.join() === 'path' && !('args' in row)));
  for (const outcome of result.tasks) {
    assert.equal(outcome.tools.length, 1); assert.equal(outcome.tools[0].ok, true); assert.equal(outcome.verified, false);
    assert.equal(outcome.cost.modelCalls, 2); assert(outcome.elapsedMs >= 0);
  }
  const restored = JSON.parse(fs.readFileSync(checkpointFile));
  const cached = await createDelegationTool({ ...options(), goal: restored }).run({ tasks, reason });
  assert.equal(calls.length, 6); assert(cached.tasks.every(task => task.cached)); assert.equal(restored.cost.modelCalls, 6);
  assert.equal(restored.tool_results.length, 3, 'cached results do not create duplicate tool evidence');
  assert.equal(fs.readFileSync(path.join(architect.workspaceDir, 'alpha.txt'), 'utf8'), 'alpha-independent-proof');
});

test('worker host refuses unadvertised writes and recursion even with owner grants, without treating a failure as verified', async t => {
  const { architect, goal, options } = await fixture(t, async ({ messages }) => ({ content: '', toolCalls: [{ id: 'escape',
    name: sourceName(messages) === 'alpha' ? 'fs_write' : 'agent_delegate', args: { path: 'forbidden.txt', content: 'bad' } }] }));
  const result = await createDelegationTool(options()).run({ tasks: tasks.slice(0, 2), reason });
  assert.equal(result.status, 'PARTIAL'); assert.equal(result.verified, false);
  assert(result.tasks.every(task => task.status === 'FAILED' && task.errorCode === 'DELEGATION_TOOL_DENIED'));
  assert.equal(fs.existsSync(path.join(architect.workspaceDir, 'forbidden.txt')), false);
  assert.equal(goal.cost.toolCalls || 0, 0);
  await assert.rejects(createDelegationTool(options()).run({ tasks: [tasks[0], tasks[0]], reason }), /unique/);
  await assert.rejects(createDelegationTool(options()).run({ tasks, reason, grant: ['shell'] }));
});

test('abort joins workers, caches completed observations and resumes only interrupted read tasks from fresh sessions', async t => {
  const controller = new AbortController(); let interrupt = true; const calls = { alpha: 0, beta: 0 };
  const { goal, options } = await fixture(t, async ({ messages, signal }) => {
    const name = sourceName(messages); calls[name]++;
    if (name === 'beta' && interrupt) {
      await new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
    const observation = messages.find(message => message.role === 'tool');
    return observation ? { content: `Observed ${name}`, usage: { input: 1, output: 1 } } : readCall(name);
  });
  const result = await createDelegationTool(options({ signal: controller.signal, onCheckpoint: () => {
    if (Object.values(goal.delegation?.tasks || {}).some(task => task.id === 'alpha' && task.status === 'COMPLETED')) controller.abort();
  } })).run({ tasks: tasks.slice(0, 2), reason });
  assert.equal(result.status, 'CANCELLED');
  assert.equal(result.tasks.find(task => task.id === 'alpha').status, 'COMPLETED');
  assert.equal(result.tasks.find(task => task.id === 'beta').status, 'CANCELLED');
  const snapshot = JSON.stringify(goal); await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(JSON.stringify(goal), snapshot, 'no late worker mutates checkpoints after cancellation returns');
  const alphaCalls = calls.alpha;
  interrupt = false;
  const resumed = await createDelegationTool(options()).run({ tasks: tasks.slice(0, 2), reason });
  assert.equal(resumed.status, 'COMPLETED'); assert.equal(calls.alpha, alphaCalls);
  assert(resumed.tasks.find(task => task.id === 'alpha').cached);
  assert.notEqual(resumed.tasks.find(task => task.id === 'beta').sessionId, result.tasks.find(task => task.id === 'beta').sessionId);
});

test('revoked permissions prevent any worker call, and six-round limits stop unresolved subtasks', async t => {
  let calls = 0;
  const { architect, options } = await fixture(t, async ({ messages }) => {
    calls++;
    return { toolCalls: [{ id: `read-${calls}`, name: 'fs_read', args: { path: `${sourceName(messages)}.txt` } }] };
  });
  const saved = options();
  architect.files.revokePermissions({ lanes: ['shell', 'browser'] });
  await assert.rejects(createDelegationTool(saved).run({ tasks: tasks.slice(0, 2), reason }), /permissions changed/);
  assert.equal(calls, 0);
  const result = await createDelegationTool(options()).run({ tasks: tasks.slice(0, 2), reason });
  assert.equal(calls, 12); assert(result.tasks.every(task => task.status === 'FAILED' && /six-round/.test(task.summary)));
});
