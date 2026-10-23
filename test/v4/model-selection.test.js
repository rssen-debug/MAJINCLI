import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import http from 'node:http';
import { startTestServer, tempHome } from './helpers.mjs';
import { discoverModels, providerOffering, refreshProviderCatalog } from '../../src/v4/models.js';
import { publicModelSelection, selectCanonicalModel, assertModelBillingAuthorized } from '../../src/v4/model-selection.js';
import { createModelClient } from '../../src/v4/model.js';
import { loadConfig } from '../../src/v4/config.js';

function setup(baseUrl = 'https://opencode.ai/zen/go/v1') {
  const home = tempHome();
  const config = { providers: { go: { kind: 'openai', baseUrl, apiKey: 'private-test-key', models: ['one', 'two'] } }, models: { routes: { chat: 'go/one' } } };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(config));
  return { home, config, clean: () => fs.rmSync(home, { recursive: true, force: true }) };
}

test('Go and Zen identity follows exact endpoint, never labels or shared model names', () => {
  assert.equal(providerOffering('https://opencode.ai/zen/go/v1'), 'opencode-go');
  assert.equal(providerOffering('https://opencode.ai/zen/v1'), 'opencode-zen');
  for (const url of ['https://opencode.ai.evil/zen/go/v1', 'http://opencode.ai/zen/go/v1', 'https://example.com/glm-5.3-flash', 'broken']) assert.equal(providerOffering(url), 'other');
  const f = setup();
  try {
    const entry = discoverModels({ home: f.home, env: {} }).models[0];
    assert.equal(entry.offering, 'opencode-go');
    assert.equal(entry.billing.label, 'Cost unknown — verify with provider');
    assert.equal(entry.billing.subscriptionIncluded, null);
    assert.equal(entry.availableThroughGo, null, 'configuration does not prove live catalogue access');
  } finally { f.clean(); }
});

test('failed refresh preserves last verified metadata, flags stale and aborts hung fetch', async () => {
  const f = setup();
  try {
    const success = await refreshProviderCatalog({ home: f.home, env: {}, providerName: 'go', fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'new', context_length: 128000, supported_parameters: ['tools'], pricing: { prompt: '0', completion: '0' } }] })) });
    let aborted = false;
    const failed = await refreshProviderCatalog({ home: f.home, env: {}, providerName: 'go', timeoutMs: 25, fetchImpl: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new Error('private-test-key')); }, { once: true })) });
    assert.equal(aborted, true);
    assert.equal(failed.at, success.at);
    assert.deepEqual(failed.models, ['new']);
    const entry = discoverModels({ home: f.home, env: {} }).models.find((m) => m.model === 'new');
    assert.equal(entry.contextWindow, 128000);
    assert.equal(entry.capabilities.tools, true);
    assert.equal(entry.billing.status, 'unknown', 'zero catalogue prices are not account entitlement evidence');
    assert.equal(entry.catalogStale, true);
    assert.ok(!JSON.stringify(discoverModels({ home: f.home, env: {} })).includes('private-test-key'));
  } finally { f.clean(); }
});

test('canonical choice requires explicit cost authorization and survives restart without altering V1 config', () => {
  const f = setup();
  const bytes = fs.readFileSync(path.join(f.home, 'config.json'));
  try {
    assertModelBillingAuthorized({ home: f.home, env: {}, modelId: 'go/one' });
    assert.throws(() => selectCanonicalModel({ home: f.home, env: {}, modelId: 'go/two', expectedVersion: 0 }), { code: 'MODEL_COST_AUTHORIZATION_REQUIRED' });
    assert.equal(publicModelSelection({ home: f.home, env: {} }).version, 0);
    const selected = selectCanonicalModel({ home: f.home, env: {}, modelId: 'go/two', expectedVersion: 0, authorizePotentialCost: true });
    assert.equal(selected.modelId, 'go/two');
    assert.equal(publicModelSelection({ home: f.home, env: {} }).version, 1);
    assertModelBillingAuthorized({ home: f.home, env: {}, modelId: 'go/two' });
    assert.throws(() => selectCanonicalModel({ home: f.home, env: {}, modelId: 'go/one', expectedVersion: 0 }), { code: 'MODEL_SELECTION_CONFLICT' });
    assert.deepEqual(fs.readFileSync(path.join(f.home, 'config.json')), bytes);
    const saved = fs.readFileSync(path.join(f.home, 'v4', 'model-selection.json'), 'utf8');
    assert.ok(!saved.includes('private-test-key'));
    f.config.providers.go.baseUrl = 'https://opencode.ai/zen/v1';
    fs.writeFileSync(path.join(f.home, 'config.json'), JSON.stringify(f.config));
    assert.throws(() => assertModelBillingAuthorized({ home: f.home, env: {}, modelId: 'go/two' }), { code: 'MODEL_COST_AUTHORIZATION_REQUIRED' }, 'authorization cannot carry from Go to Zen');
  } finally { f.clean(); }
});

test('two paired clients cannot overwrite a newer canonical choice with a stale version', async () => {
  const f = setup(); const s = await startTestServer({ home: f.home });
  try {
    const a = s.existingSession(), b = s.existingSession();
    const post = (cookie, modelId) => fetch(`${s.base}/api/model`, { method: 'POST', headers: { cookie, origin: s.base, 'x-majin-csrf': '1', 'content-type': 'application/json' }, body: JSON.stringify({ modelId, expectedVersion: 0, authorizePotentialCost: true }) });
    const results = await Promise.all([post(a, 'go/one'), post(b, 'go/two')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    const read = async (cookie) => (await (await fetch(`${s.base}/api/models`, { headers: { cookie } })).json()).selection;
    assert.deepEqual(await read(a), await read(b));
    assert.equal((await read(a)).version, 1);
  } finally { await s.close(); }
});

test('actual HTTP transport uses canonical model for subsequent calls, no fallback on failure', async () => {
  const received = [];
  let fail = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const b of req) raw += b;
    received.push(JSON.parse(raw).model);
    if (fail) { res.writeHead(400, { 'content-type': 'application/json' }); res.end('{"error":{"message":"not available"}}'); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"verified fixture"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const f = setup(`http://127.0.0.1:${upstream.address().port}`);
  try {
    const config = loadConfig({ env: { MAJIN_HOME: f.home }, argv: [], platform: 'linux' });
    const client = createModelClient(config);
    await assert.rejects(client.chat({ messages: [{ role: 'user', content: 'hello' }], modelId: 'go/two' }), { code: 'MODEL_COST_AUTHORIZATION_REQUIRED' });
    assert.deepEqual(received, [], 'unapproved routes make no network call');
    selectCanonicalModel({ home: f.home, env: {}, modelId: 'go/two', expectedVersion: 0, authorizePotentialCost: true });
    const response = await client.chat({ messages: [{ role: 'user', content: 'hello' }], modelId: 'go/one' });
    assert.equal(response.model, 'two');
    assert.deepEqual(received, ['two']);
    const restarted = createModelClient(config);
    assert.equal(restarted.info.model, 'two');
    fail = true;
    await assert.rejects(restarted.chat({ messages: [{ role: 'user', content: 'hello' }] }));
    assert.deepEqual(received, ['two', 'two'], 'failure never routes to another model');
    f.config.providers.go.models = ['one'];
    fs.writeFileSync(path.join(f.home, 'config.json'), JSON.stringify(f.config));
    await assert.rejects(restarted.chat({ messages: [] }), /No fallback/);
    assert.deepEqual(received, ['two', 'two']);
  } finally { f.clean(); await new Promise((r) => upstream.close(r)); }
});

test('corrupt saved selection fails closed without silently overwriting it', () => {
  const f = setup();
  try {
    fs.mkdirSync(path.join(f.home, 'v4'));
    const file = path.join(f.home, 'v4', 'model-selection.json');
    fs.writeFileSync(file, '{broken');
    assert.throws(() => publicModelSelection({ home: f.home, env: {} }), { code: 'MODEL_SELECTION_INVALID' });
    assert.throws(() => selectCanonicalModel({ home: f.home, env: {}, modelId: 'go/one', expectedVersion: 0 }), { code: 'MODEL_SELECTION_INVALID' });
    assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  } finally { f.clean(); }
});
