import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('first-run onboarding is mounted and only appears when setup is missing', () => {
  const html = read('src/ui/index.html');
  assert.match(html, /id="onboard" hidden/, 'the wizard exists and starts hidden');
  assert.match(html, /aria-modal="true"/, 'it is a real dialog');
  assert.match(html, /onboard\.js"><\/script>\s*<script src="\/app\.js">/, 'onboard.js loads before app.js');
  const src = read('src/ui/onboard.js');
  assert.match(src, /st && st\.needsSetup/, 'it opens only when the server says setup is missing');
  assert.doesNotMatch(src, /MAJIN_ONBOARD\.open\(\)/, 'it never force-opens over a working config');
});

test('the wizard writes through the EXISTING systems only', () => {
  const src = read('src/ui/onboard.js');
  assert.match(src, /apiLocal\('\/provider', \{ method: 'POST', body: \{ action: 'add'/, 'keys are saved via the existing provider tool');
  assert.match(src, /action: 'test'/, 'connectivity is proven by the existing test action');
  assert.match(src, /action: 'models'/, 'the catalogue comes from the existing models action');
  assert.match(src, /apiLocal\('\/config', \{ method: 'PATCH'/, 'model choice is written via the config patch path');
  assert.doesNotMatch(src, /localStorage\.setItem\('(key|api)/, 'keys never touch localStorage');
  assert.doesNotMatch(src, /\.innerHTML\s*=/, 'provider and model strings stay inert');
});

test('onboarding ends in single-model mode: one ref on every route, MOA off', () => {
  const src = read('src/ui/onboard.js');
  const m = src.match(/ROUTES_JOBS|ROUTE_JOBS/);
  assert.ok(m, 'a job list drives the single-model patch');
  assert.match(src, /Object\.fromEntries\(ROUTE_JOBS\.map\(\(j\) => \[j, OB\.provider\.name \+ '\/' \+ model\]\)\)/, 'every job gets the chosen model');
  assert.match(src, /moa: \{ policy: 'off' \}/, 'no hidden multi-agent spend behind a setup choice');
});

test('the header model chip reuses the same patch path and hides when unset', () => {
  const html = read('src/ui/index.html');
  assert.match(html, /id="c-model" hidden/, 'the picker chip exists, hidden until a model exists');
  assert.match(html, /id="modeldrop" hidden/, 'the dropdown exists, hidden');
  const app = read('src/ui/app.js');
  assert.match(app, /\$\('c-model'\)\.onclick/, 'the chip is clickable');
  const src = read('src/ui/onboard.js');
  assert.match(src, /window\.refresh/, 'a successful switch repaints through the normal funnel');
});
