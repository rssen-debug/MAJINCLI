/**
 * Config: DEFAULTS måste vara ren JSON, patch valideras, hemligheter maskas,
 * rutter löser ut till färdiga provider-referenser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS, merge, clone, redact, validatePatch, toRegex, Config, isPlain, JOBS } from '../src/core/config.js';

function tmpHome(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-cfg-'));
  process.env.MAJIN_CONFIG = path.join(dir, 'config.json');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('DEFAULTS är ren JSON (inget RegExp/funktioner)', () => {
  const seen = [];
  (function walk(o, p) {
    for (const [k, v] of Object.entries(o || {})) {
      const np = `${p}.${k}`;
      if (v instanceof RegExp || typeof v === 'function') seen.push(np);
      else if (isPlain(v)) walk(v, np);
      else if (Array.isArray(v)) v.forEach((x, i) => isPlain(x) && walk(x, `${np}[${i}]`));
    }
  })(DEFAULTS, '');
  assert.deepEqual(seen, [], `icke-JSON i DEFAULTS: ${seen.join(', ')}`);
  assert.doesNotThrow(() => structuredClone(DEFAULTS));
});

test('MOA behaviour is wired: opt-in policy, references + aggregator present', () => {
  assert.equal(DEFAULTS.moa.enabled, true);
  assert.equal(DEFAULTS.moa.policy, 'off', 'simple mode promise: multi-model spend is opt-in, always');
  assert.ok(DEFAULTS.moa.references.length >= 2);
  assert.ok(JOBS.includes('aggregator'));
  assert.ok(DEFAULTS.models.routes.aggregator);
});

test('merge: arrayer ersätts, objekt djupmixas, undefined stryks', () => {
  const base = { a: { b: 1, c: 2 }, arr: [1, 2, 3] };
  const out = merge(base, { a: { c: 9 }, arr: [7] });
  assert.deepEqual(out, { a: { b: 1, c: 9 }, arr: [7] });
  assert.deepEqual(merge(base, { a: { c: undefined } }).a, { b: 1 });
  assert.notEqual(out.a, base.a, 'originalet får inte muteras');
});

test('validatePatch: känn vid toppnycklar, rutter och regex', () => {
  assert.equal(validatePatch({ name: 'X' }, clone(DEFAULTS)).length, 0);
  const bad = validatePatch({ bogus: 1 }, clone(DEFAULTS));
  assert.equal(bad.length, 1);
  assert.match(bad[0].msg, /unknown top-level key/);
  assert.ok(validatePatch({ models: { routes: { snusk: 'a/b' } } }, clone(DEFAULTS)).length > 0);
  assert.ok(validatePatch({ models: { routes: { code: 'utankustav/' } } }, clone(DEFAULTS)).length > 0);
  assert.ok(validatePatch({ moa: { references: [{ model: 'a/b' }] } }, clone(DEFAULTS)).length > 0);
  assert.equal(validatePatch({ moa: { references: [{ model: 'a/b' }, { model: 'a/c' }] } }, clone(DEFAULTS)).length, 0);
  assert.ok(toRegex('(') instanceof RegExp, 'olycklig regex måste ändå bli en bokstavlig, inte krascha');
  assert.equal(validatePatch({ routing: { rules: [{ match: '/ok/i', job: 'code' }] } }, clone(DEFAULTS)).length, 0);
  assert.ok(validatePatch({ providers: { x: { label: 'X' } } }, clone(DEFAULTS)).length > 0, 'ny provider utan baseUrl nekas');
  assert.equal(validatePatch({ providers: { ollama: { apiKey: 'x' } } }, clone(DEFAULTS)).length, 0, 'partial patch på befintlig provider tillåts');
});

test('toRegex: "/x/i" och råa strängar, giltiga REGEXP alltid kompilerbara', () => {
  assert.ok(toRegex('/abc/i') instanceof RegExp);
  assert.equal(toRegex('/abc/i').flags.includes('i'), true);
  assert.ok(toRegex('abc') instanceof RegExp);
  for (const key of ['askOn', 'neverOn']) {
    for (const pat of DEFAULTS.guard[key]) {
      const re = toRegex(pat);
      assert.ok(re instanceof RegExp, `${key}: ${pat} blev ingen regex`);
    }
  }
  for (const rule of DEFAULTS.routing.rules) assert.ok(toRegex(rule.match) instanceof RegExp, rule.match);
});

test('redact maskerar nycklar men inte struktur', () => {
  const r = redact({ providers: { deepseek: { apiKey: 'sk-verysecret1234567890', baseUrl: 'https://x' } }, server: { token: 'abcd1234' } });
  assert.match(r.providers.deepseek.apiKey, /^sk/);
  assert.ok(!JSON.stringify(r).includes('verysecret'));
  assert.equal(r.providers.deepseek.baseUrl, 'https://x');
  assert.ok(!JSON.stringify(r).includes('abcd1234'));
});

test('Config: patch skriver diff, sparar fil, backar gammal, håller lyssnare', (t) => {
  const dir = tmpHome(t);
  const file = path.join(dir, 'config.json');
  const cfg = new Config(clone(DEFAULTS), file);
  cfg.save();
  let notified = 0;
  cfg.onChange(() => {
    notified += 1;
  });
  const r = cfg.patch({ name: 'LENT2', moa: { width: 4 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.diff.map((d) => d.path).sort(), ['moa.width', 'name']);
  assert.equal(notified, 1);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.name, 'LENT2');
  assert.equal(fs.existsSync(file + '.bak'), true);
  assert.equal(cfg.get('moa.width'), 4);
  const bad = cfg.patch({ ingen: 'sånt' });
  assert.equal(bad.ok, false);
  assert.equal(cfg.get('name'), 'LENT2', 'underkänd patch får inte ändra något');
});

test('resolveModel/routeTable: ref → provider+kind, fallback när nyckel saknas', (t) => {
  const dir = tmpHome(t);
  const cfg = new Config(clone(DEFAULTS), path.join(dir, 'c.json'));
  cfg.patch({ providers: { deepseek: { apiKey: 'sk-test' } } });
  const r = cfg.resolveModel('deepseek/deepseek-v4-pro', 'code');
  assert.equal(r.providerName, 'deepseek');
  assert.equal(r.model, 'deepseek-v4-pro');
  assert.equal(r.kind, 'openai');
  assert.ok(r.baseUrl.includes('deepseek'));
  const table = cfg.routeTable();
  assert.equal(table.length, JOBS.length);
  for (const row of table) assert.ok(row.job && row.ref, row.job);
  const noKey = cfg.providerStatus().find((p) => p.name === 'nous');
  assert.equal(noKey.ready, false);
  const patched = cfg.patch({ models: { routes: { code: 'nous/x' } } });
  assert.equal(patched.ok, true);
  const row = cfg.routeTable().find((x) => x.job === 'code');
  assert.equal(row.ready, false, 'rutt till nyckellös provider markeras inte ready');
  assert.ok(DEFAULTS.providers.nous, 'presets ska finnas listade från början');
});

test('needsSetup: demo/mock räknas inte som riktig nyckel', (t) => {
  const dir = tmpHome(t);
  const cfg = new Config(clone(DEFAULTS), path.join(dir, 'c.json'));
  assert.equal(cfg.needsSetup(), true, 'bara demo-nyckel = måste fortfarande ställa in sig');
  cfg.patch({ providers: { groq: { apiKey: 'gsk_x' } } });
  assert.equal(cfg.needsSetup(), false);
  const groq = cfg.providerStatus().find((p) => p.name === 'groq');
  assert.equal(groq.ready, true);
  assert.ok(groq.models.length >= 1);
  assert.equal(cfg.realProviders().some((p) => p.kind === 'mock'), false);
});

test('öppen router-modell-id med snedstreck löser rätt provider', (t) => {
  const dir = tmpHome(t);
  const cfg = new Config(clone(DEFAULTS), path.join(dir, 'c.json'));
  cfg.patch({ providers: { openrouter: { apiKey: 'sk-or-1' } }, models: { routes: { code: 'openrouter/deepseek/deepseek-v4-pro' } } });
  const r = cfg.resolveModel('openrouter/deepseek/deepseek-v4-pro', 'code');
  assert.equal(r.providerName, 'openrouter');
  assert.equal(r.model, 'deepseek/deepseek-v4-pro');
  assert.equal(r.baseUrl, 'https://openrouter.ai/api/v1');
});
