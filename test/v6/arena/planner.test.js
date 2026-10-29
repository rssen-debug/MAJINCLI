/**
 * Planner: configuration gating and strict decision parsing.
 *
 * The provider call is exercised against a real loopback HTTP endpoint that
 * speaks the OpenAI chat-completions dialect. The stub is a fixture; the
 * transport, retry, parsing and accounting are the production code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { loadPlannerConfig, parseDecision, askPlanner, trimRationale } from '../../../src/v6/arena/planner.js';

const MISSION = Object.freeze({
  id: 'm-frontend',
  goal: 'Find frontend roles and prepare applications',
  allowedActions: ['tool', 'job.discover', 'job.evaluate'],
  allowedTools: ['fs_read', 'fs_write', 're_hash'],
  constraints: ['never submit without approval'],
  stopWhen: 'two applications are approved',
  notes: null,
});

async function stubProvider(t, handler) {
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const result = await handler(body);
    response.writeHead(result.status || 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(result.json));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { url: `http://127.0.0.1:${server.address().port}`, server };
}

function routeFor(url) {
  return {
    kind: 'openai', providerName: 'Stub', provider: 'stub',
    baseUrl: url, endpoint: `${url}/v1/chat/completions`,
    apiKey: 'test-key', model: 'stub-model', maxTokens: 256, temperature: 0, pricing: { in: 1, out: 2 },
  };
}

test('a missing provider key is BLOCKED, never a silent mock', () => {
  const missing = loadPlannerConfig({ env: { MAJIN_ARENA_PROVIDER: 'deepseek' } });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'PLANNER_KEY_MISSING');
  assert.match(missing.error.reason, /DEEPSEEK_API_KEY|planner-key/);

  const unknown = loadPlannerConfig({ env: { MAJIN_ARENA_PROVIDER: 'not-a-provider' } });
  assert.equal(unknown.error.code, 'PLANNER_PROVIDER_UNKNOWN');

  const ok = loadPlannerConfig({
    env: { MAJIN_ARENA_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'k'.repeat(32), MAJIN_ARENA_MODEL: 'deepseek-flash' },
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.config.model, 'deepseek-flash');
  assert.match(ok.config.route.endpoint, /^https:\/\/api\.deepseek\.com\/chat\/completions$/);
  assert.equal(ok.config.keySource, 'DEEPSEEK_API_KEY');
});

test('a decision is only accepted when it is valid JSON and inside the mission', () => {
  const good = parseDecision('{"action":"tool","payload":{"tool":"fs_read","arguments":{"path":"a.txt"}},"rationale":"read the file"}', { mission: MISSION });
  assert.equal(good.ok, true);
  assert.equal(good.decision.action, 'tool');
  assert.equal(good.decision.done, false);

  const fenced = parseDecision('```json\n{"action":"stop","done":true,"summary":"nothing to do"}\n```', { mission: MISSION });
  assert.equal(fenced.ok, true);
  assert.equal(fenced.decision.done, true);

  assert.equal(parseDecision('I think we should read a file.', { mission: MISSION }).error.code, 'PLANNER_NOT_JSON');
  assert.equal(parseDecision('{"action":"rm_rf"}', { mission: MISSION }).error.code, 'PLANNER_ACTION_UNKNOWN');
  assert.equal(
    parseDecision('{"action":"job.submit","payload":{"applicationId":"x"}}', { mission: MISSION }).error.code,
    'PLANNER_ACTION_NOT_ALLOWED',
  );
  assert.equal(
    parseDecision('{"action":"tool","payload":{"tool":"shell_run","arguments":{"cmd":"whoami"}}}', { mission: MISSION }).error.code,
    'PLANNER_TOOL_NOT_ALLOWED',
  );
  assert.equal(parseDecision('{"action":"tool","payload":{}}', { mission: MISSION }).error.code, 'PLANNER_TOOL_MISSING');
});

test('rationale is bounded and single-line so no hidden reasoning is stored', () => {
  const text = trimRationale(`line one\nline two ${'x'.repeat(500)}`);
  assert.equal(text.includes('\n'), false);
  assert.ok(text.length <= 240);
});

test('the planner is read over a real HTTP endpoint and its usage is accounted', async (t) => {
  const stub = await stubProvider(t, () => ({
    json: {
      model: 'stub-model',
      choices: [{ message: { content: '{"action":"job.discover","payload":{"candidateId":"c1","query":"frontend"},"rationale":"need fresh listings"}' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    },
  }));
  const config = { provider: 'stub', model: 'stub-model', route: routeFor(stub.url), keySource: 'test' };
  const answer = await askPlanner({ config, mission: MISSION, state: { step: 0, budgetLeft: {}, tasks: [], applications: {}, lastResult: null } });
  assert.equal(answer.ok, true, answer.error?.reason);
  assert.equal(answer.decision.action, 'job.discover');
  assert.equal(answer.usage.input, 120);
  assert.equal(answer.usage.output, 30);
  assert.ok(answer.usage.costUsd > 0, 'pricing produces a real cost figure');
});

test('a provider error is reported as a typed stop, not as a decision', async (t) => {
  const stub = await stubProvider(t, () => ({ status: 401, json: { error: { message: 'invalid api key' } } }));
  const config = { provider: 'stub', model: 'stub-model', route: routeFor(stub.url), keySource: 'test' };
  const answer = await askPlanner({ config, mission: MISSION, state: { step: 0, budgetLeft: {}, tasks: [], applications: {}, lastResult: null } });
  assert.equal(answer.ok, false);
  assert.match(String(answer.error.code), /^PLANNER_/);
  assert.ok(answer.error.reason.length > 0);
});
