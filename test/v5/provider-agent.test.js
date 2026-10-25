import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createV5Server } from '../../src/v5/server.js';
import { ProviderAgent } from '../../src/v5/provider-agent.js';
import { classifyProviderError } from '../../src/v5/providers.js';
import { responsesInput } from '../../src/core/provider/responses.js';
import { toAnthropic } from '../../src/core/provider/anthropic.js';

async function setup(t, respond) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-provider-agent-'));
  const requests = [];
  const upstream = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    requests.push({ body, headers: req.headers, url: req.url });
    const message = await respond(body, requests.length);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'local-response', model: body.model, choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const server = createV5Server({ dataDir: root });
  const providers = server.architect.providers;
  await providers.configureProvider({ providerId: 'opencode-go', apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${upstream.address().port}/v1` });
  providers.selectModel({ providerId: 'opencode-go', modelId: 'deepseek-v4-pro', allowManualFallback: true });
  t.after(async () => { await server.providerAgent.cancel(); if (server.server.listening) await server.stop(); await new Promise(resolve => upstream.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, requests, server };
}
const tool = (id, name, args, reasoning_content) => ({ role: 'assistant', content: null, reasoning_content,
  tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

test('actual HTTP transport advertises tools, executes a failure/recovery loop and preserves DeepSeek reasoning/session headers', async t => {
  const { requests, server } = await setup(t, (_body, count) => {
    if (count === 1) return tool('read-missing', 'fs_read', { path: 'result.txt' }, 'local fixture protocol continuation');
    if (count === 2) return tool('write-result', 'fs_write', { path: 'result.txt', content: 'verified fixture' });
    if (count === 3) return tool('read-result', 'fs_read', { path: 'result.txt' });
    return { role: 'assistant', content: 'Created result.txt and read it back.' };
  });
  const { url } = await server.start();
  const response = await fetch(url + '/api/v5/goal', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ goalText: 'Create result.txt containing verified fixture', criteria: [{ kind: 'file', path: 'result.txt', contains: 'verified fixture' }] }) });
  const result = await response.json();
  assert.equal(result.status, 'COMPLETED', JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(server.architect.workspaceDir, 'result.txt'), 'utf8'), 'verified fixture');
  assert.deepEqual(result.tool_results.map(row => row.ok), [false, true, true]);
  assert.equal(requests.length, 4);
  assert(requests[0].body.tools.some(t => t.function.name === 'fs_write'));
  assert(!requests[0].body.tools.some(t => t.function.name === 'shell_run'), 'no process tool without owner grant');
  assert.equal(requests[0].headers.authorization, 'Bearer local-test-key');
  assert.match(requests[0].headers['user-agent'], /majin-v5/);
  assert.equal(new Set(requests.map(r => r.headers['x-opencode-session'])).size, 1);
  assert.equal(requests[1].body.messages.find(m => m.role === 'assistant').reasoning_content, 'local fixture protocol continuation');
  assert.equal(requests[1].body.messages.find(m => m.role === 'assistant').tool_calls[0].function.name, 'fs_read');
  assert.equal(requests[1].body.messages.find(m => m.role === 'tool').name, 'fs_read');
  assert(requests[1].body.messages.some(m => m.role === 'tool' && /failed/.test(m.content)));
  assert.equal(result.verification_evidence.length, 1);
  const assistant = server.providerAgent.current.messages.find(m => m.tool_calls?.length);
  assert.equal(responsesInput([assistant])[0].arguments, '{"path":"result.txt"}');
  assert.deepEqual(toAnthropic([assistant]).messages[0].content[0].input, { path: 'result.txt' });
});
test('a successful write and model claim do not fabricate task verification or XP', async t => {
  const { server } = await setup(t, (_body, count) => count === 1
    ? tool('write', 'fs_write', { path: 'unverified.txt', content: 'anything' })
    : { role: 'assistant', content: 'Everything verified, give me XP.' });
  const result = await server.providerAgent.execute({ goalText: 'Create a report' });
  assert.equal(result.status, 'PARTIAL');
  assert.equal(result.xp_award, null); assert.equal(result.verification_evidence.length, 0);
});
test('conversation survives restart and uses a stable Go session ID without replaying an append', async t => {
  const { server, requests } = await setup(t, (_body, count) => count === 1
    ? tool('append', 'fs_write', { path: 'once.txt', content: 'once', append: true })
    : { role: 'assistant', content: 'Observed the previous result.' });
  await server.providerAgent.execute({ goalText: 'Append once' });
  const restored = new ProviderAgent({ architect: server.architect });
  await restored.execute({ goalText: 'What was the previous result?' });
  assert.equal(fs.readFileSync(path.join(server.architect.workspaceDir, 'once.txt'), 'utf8'), 'once');
  assert.equal(new Set(requests.map(r => r.headers['x-opencode-session'])).size, 1);
  assert(requests.at(-1).body.messages.some(m => m.role === 'tool' && /once/.test(m.content)));
});
test('repeated failed actions are observed and stopped rather than blindly executed', async t => {
  const { server } = await setup(t, (_body, count) => tool(`missing-${count}`, 'fs_read', { path: 'does-not-exist' }));
  const result = await server.providerAgent.execute({ goalText: 'Read a missing file' });
  assert.equal(result.status, 'BLOCKED');
  assert(result.tool_results.some(r => r.errorCode === 'REPEATED_FAILED_ACTION'));
});

test('resume after restart preserves identity, criteria, costs and observed effects; completed resume is idempotent', async t => {
  const { server, requests } = await setup(t, (_body, count) => {
    if (count === 1) return tool('same-provider-id', 'fs_write', { path: 'once.txt', content: 'once', append: true });
    if (count === 2) return tool('same-provider-id', 'fs_write', { path: 'ready.txt', content: 'ready' });
    return { role: 'assistant', content: 'Finished from the checkpoint.' };
  });
  server.providerAgent.maxRounds = 1;
  const criteria = [{ kind: 'file', path: 'ready.txt', contains: 'ready' }];
  const initial = await server.providerAgent.execute({ goalText: 'Append once and create ready.txt', criteria });
  assert.equal(initial.status, 'BLOCKED');
  const restored = new ProviderAgent({ architect: server.architect });
  const result = await restored.execute({ resume: true });
  assert.equal(result.goal_id, initial.goal_id);
  assert.equal(result.objective, initial.objective);
  assert.deepEqual(result.criteria, criteria);
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.tool_results.length, 2);
  assert.equal(result.cost.modelCalls, 3);
  assert.equal(result.resume_count, 1);
  assert.equal(fs.readFileSync(path.join(server.architect.workspaceDir, 'once.txt'), 'utf8'), 'once');
  assert.notEqual(result.tool_results[0].operationId, result.tool_results[1].operationId);
  assert.equal(new Set(requests.map(r => r.headers['x-opencode-session'])).size, 1);
  const completed = await restored.execute({ resume: true });
  assert.equal(completed.goal_id, initial.goal_id);
  assert.equal(requests.length, 3, 'completed resume makes no model or tool calls');
  await assert.rejects(restored.execute({ resume: true, criteria: [] }), /cannot replace saved acceptance/);
});

test('HTTP resume retains saved acceptance checks when the request omits criteria', async t => {
  const { server } = await setup(t, (_body, count) => count === 1
    ? tool('write', 'fs_write', { path: 'proof.txt', content: 'proof' })
    : { role: 'assistant', content: 'Read the saved result.' });
  const { url } = await server.start();
  server.providerAgent.maxRounds = 1;
  const original = await server.providerAgent.execute({ goalText: 'Create proof.txt', criteria: [{ kind: 'file', path: 'proof.txt', contains: 'proof' }] });
  server.providerAgent.maxRounds = 32;
  const response = await fetch(url + '/api/v5/goal/resume', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(response.status, 200);
  const { goal } = await response.json();
  assert.equal(goal.goal_id, original.goal_id);
  assert.equal(goal.status, 'COMPLETED');
  assert.equal(goal.verification_evidence.length, 1);
});
test('403 access policy is distinguished from an invalid API key', () => {
  assert.equal(classifyProviderError(new Error('Region not allowed'), 403).code, 'ACCESS_DENIED');
  assert.equal(classifyProviderError(new Error('Invalid API key'), 401).code, 'AUTH_INVALID');
});

test('stop aborts a live provider request before its proposed file action can execute', async t => {
  let entered;
  const requested = new Promise(resolve => { entered = resolve; });
  const { server } = await setup(t, async () => {
    entered();
    await new Promise(resolve => setTimeout(resolve, 200));
    return tool('too-late', 'fs_write', { path: 'should-not-exist.txt', content: 'late' });
  });
  const running = server.providerAgent.execute({ goalText: 'Wait for a model action' });
  await requested;
  await server.providerAgent.cancel();
  const result = await running;
  assert.equal(result.status, 'CANCELLED');
  assert.equal(fs.existsSync(path.join(server.architect.workspaceDir, 'should-not-exist.txt')), false);
  assert.equal(server.providerAgent.active, null);
});

test('a catalog without capability metadata does not silently disable tools; explicit false is respected', async t => {
  const { server } = await setup(t, () => ({ role: 'assistant', content: 'ok' }));
  server.architect.providers.fetchImpl = async () => new Response(JSON.stringify({ data: [
    { id: 'deepseek-v4-pro' }, { id: 'text-only', capabilities: { tools: false } },
  ] }), { headers: { 'content-type': 'application/json' } });
  const result = await server.architect.providers.discoverCatalog('opencode-go');
  assert.equal(result.ok, true);
  assert.equal(server.architect.providers.getCapabilities('opencode-go', 'deepseek-v4-pro').tools, true);
  assert.equal(server.architect.providers.getCapabilities('opencode-go', 'text-only').tools, false);
});
