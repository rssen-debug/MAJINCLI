import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tempHome, startTestServer, postChat } from './helpers.mjs';
import { discoverModels, resolveRouteForModel } from '../../src/v4/models.js';

const V1_SECRET = 'sk-live-must-never-leak-0123456789';

function writeV1Config(home, extra = {}) {
  const cfg = {
    version: 1,
    providers: {
      deepseek: {
        label: 'DeepSeek',
        kind: 'openai',
        baseUrl: 'https://api.deepseek.example',
        apiKey: V1_SECRET,
        models: ['deepseek-chat', 'deepseek-reasoner'],
      },
      openrouter: {
        label: 'OpenRouter',
        kind: 'openai',
        baseUrl: 'https://openrouter.example/api',
        apiKey: '{env:OPENROUTER_KEY}',
        models: ['z-ai/glm-4.6'],
      },
      unconfigured: {
        label: 'Tom',
        kind: 'openai',
        baseUrl: 'https://empty.example',
        apiKey: null,
        models: ['nothing-here'],
      },
    },
    models: { routes: { chat: 'deepseek/deepseek-chat', tasks: 'deepseek/deepseek-chat' } },
    ...extra,
  };
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify(cfg, null, 2));
}

test('models: existing V1 providers are discovered without reading a key', () => {
  const home = tempHome();
  writeV1Config(home);
  const cat = discoverModels({ home, env: {} });
  assert.equal(cat.source, 'v1-config');
  const ids = cat.models.map((m) => m.id);
  assert.ok(ids.includes('deepseek/deepseek-chat'));
  assert.ok(ids.includes('deepseek/deepseek-reasoner'));
  const noKey = cat.models.find((m) => m.id === 'openrouter/z-ai/glm-4.6');
  assert.ok(noKey, 'model is still listed so the phone can explain why it is unavailable');
  assert.equal(noKey.configured, false);
  assert.equal(noKey.status, 'missing-key');
  assert.equal(cat.current, 'deepseek/deepseek-chat');
  assert.equal(cat.models.find((m) => m.id === 'deepseek/deepseek-chat').liveVerified, false);
  assert.equal(JSON.stringify(cat).includes(V1_SECRET), false, 'no credential may appear in the catalogue');
  fs.rmSync(home, { recursive: true, force: true });
});

test('models: an env-backed key is resolved for discovery but never serialised', () => {
  const home = tempHome();
  writeV1Config(home);
  const cat = discoverModels({ home, env: { OPENROUTER_KEY: 'rot-secret-value' } });
  const entry = cat.models.find((m) => m.id === 'openrouter/z-ai/glm-4.6');
  assert.ok(entry);
  assert.equal(entry.configured, true);
  assert.equal(JSON.stringify(cat).includes('rot-secret-value'), false);
  fs.rmSync(home, { recursive: true, force: true });
});

test('models: route resolution rejects ids that are not in the configured catalogue', () => {
  const home = tempHome();
  writeV1Config(home);
  const env = {};
  assert.equal(resolveRouteForModel({ home, env, modelId: 'deepseek/deepseek-chat' }).model, 'deepseek-chat');
  assert.equal(resolveRouteForModel({ home, env, modelId: 'deepseek/not-declared' }), null);
  assert.equal(resolveRouteForModel({ home, env, modelId: 'evil/model' }), null);
  assert.equal(resolveRouteForModel({ home, env, modelId: '../../etc/passwd' }), null);
  assert.equal(resolveRouteForModel({ home, env, modelId: '' }), null);
  fs.rmSync(home, { recursive: true, force: true });
});

test('models: the API lists the host catalogue and never a key', async () => {
  const home = tempHome();
  writeV1Config(home);
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const res = await fetch(`${s.base}/api/models`, { headers: { cookie } });
    const raw = await res.text();
    assert.equal(res.status, 200);
    assert.equal(raw.includes(V1_SECRET), false);
    const data = JSON.parse(raw);
    assert.ok(data.models.length >= 2);
    assert.ok(data.models.every((m) => !('apiKey' in m) && !('baseUrl' in m)));
    assert.ok(data.models.every((m) => m.liveVerified === false));
  } finally {
    await s.close();
  }
});

test('models: mobile alias endpoint requires a session', async () => {
  const s = await startTestServer();
  try {
    const res = await fetch(`${s.base}/api/models`);
    assert.equal(res.status, 401);
  } finally {
    await s.close();
  }
});

test('models: selecting a configured model is scoped to the conversation', async () => {
  const home = tempHome();
  writeV1Config(home);
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const created = await fetch(`${s.base}/api/conversations`, {
      method: 'POST',
      headers: { cookie, 'x-majin-csrf': '1', origin: s.base },
    });
    const conv = (await created.json()).conversation;

    const select = await fetch(`${s.base}/api/model`, {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
      body: JSON.stringify({ conversationId: conv.id, modelId: 'deepseek/deepseek-reasoner' }),
    });
    assert.equal(select.status, 200);
    const body = await select.json();
    assert.equal(body.modelId, 'deepseek/deepseek-reasoner');

    const read = await fetch(`${s.base}/api/conversation?id=${conv.id}`, { headers: { cookie } });
    assert.equal((await read.json()).conversation.modelId, 'deepseek/deepseek-reasoner');

    const other = await fetch(`${s.base}/api/conversations`, {
      method: 'POST',
      headers: { cookie, 'x-majin-csrf': '1', origin: s.base },
    });
    const otherId = (await other.json()).conversation.id;
    const otherRead = await fetch(`${s.base}/api/conversation?id=${otherId}`, { headers: { cookie } });
    assert.equal((await otherRead.json()).conversation.modelId, null, 'other conversations are untouched');
  } finally {
    await s.close();
  }
});

test('models: selecting an unknown or unconfigured model is refused', async () => {
  const home = tempHome();
  writeV1Config(home);
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const created = await fetch(`${s.base}/api/conversations`, {
      method: 'POST',
      headers: { cookie, 'x-majin-csrf': '1', origin: s.base },
    });
    const conv = (await created.json()).conversation;
    for (const modelId of ['evil/model', 'deepseek/not-declared', 'openrouter/z-ai/glm-4.6']) {
      const res = await fetch(`${s.base}/api/model`, {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json', 'x-majin-csrf': '1', origin: s.base },
        body: JSON.stringify({ conversationId: conv.id, modelId }),
      });
      assert.equal(res.status, 400, modelId);
      assert.equal((await res.json()).error.code, 'MODEL_NOT_CONFIGURED');
    }
  } finally {
    await s.close();
  }
});

test('models: a broken config degrades to demo instead of crashing', async () => {
  const home = tempHome();
  fs.writeFileSync(path.join(home, 'config.json'), '{not json');
  const s = await startTestServer({ home });
  try {
    const { cookie } = await s.pair();
    const state = await fetch(`${s.base}/api/state`, { headers: { cookie } });
    const body = await state.json();
    assert.equal(body.model.demo, true);
    assert.equal(body.models.count, 0);
    const cat = discoverModels({ home, env: {} });
    assert.equal(cat.configReadable, false);
  } finally {
    await s.close();
  }
});

test('models: the demo lane answers without any provider and is labelled as demo', async () => {
  const s = await startTestServer();
  try {
    const { cookie } = await s.pair();
    const res = await postChat(s.base, cookie, { text: 'Hej' });
    const raw = await res.text();
    assert.ok(raw.includes('"demo":true'));
    assert.ok(raw.includes('demo-läge') || raw.includes('demo mode'));
  } finally {
    await s.close();
  }
});
