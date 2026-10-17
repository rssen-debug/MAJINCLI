import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Config, DEFAULTS, clone, merge } from '../src/core/config.js';

test('single-model mode: every job resolves to the one chosen model', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-single-'));
  const cfg = new Config(clone(DEFAULTS), path.join(dir, 'config.json'));
  const r = cfg.patch({
    providers: { localbox: { label: 'Local Box', kind: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'x', models: ['solo-1'] } },
    models: {
      provider: 'localbox',
      routes: Object.fromEntries(['chat', 'tasks', 'tools', 'code', 're', 'analysis', 'plan', 'research', 'summarize', 'router', 'final', 'aggregator', 'vision'].map((j) => [j, 'localbox/solo-1'])),
    },
    moa: { policy: 'off' },
  });
  assert.equal(r.ok, true, 'the onboarding-shaped patch is valid: ' + JSON.stringify(r.errors));

  for (const job of ['chat', 'tasks', 'tools', 'code', 'analysis', 'plan', 'research', 'final', 'router', 'aggregator']) {
    const route = cfg.resolveModel('', job);
    assert.equal(route.ref, 'localbox/solo-1', `job ${job} secretly routed elsewhere`);
    assert.equal(route.providerName, 'localbox');
  }
  assert.equal(cfg.get('moa.policy'), 'off', 'MOA stays off unless the user turns it on');

  // and it survives a restart: the saved file is what boot merges (same as load())
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  const again = new Config(merge(clone(DEFAULTS), stored), path.join(dir, 'config.json'));
  assert.equal(again.resolveModel('', 'code').ref, 'localbox/solo-1', 'the restart read the saved routes');
  assert.equal(again.get('moa.policy'), 'off');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a never-setup install still says needsSetup — the wizard will greet it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-fresh-'));
  const cfg = new Config(clone(DEFAULTS), path.join(dir, 'config.json'));
  assert.equal(cfg.needsSetup(), true, 'a blank install needs the wizard (the demo mock does not count as a real provider)');
  fs.rmSync(dir, { recursive: true, force: true });
});
