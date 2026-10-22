import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../src/ui/index.html', import.meta.url), 'utf8');
const aurora = html.split('/* MAJIN Aurora: accessible, responsive composer polish (2026-10-22) */')[1]?.split('</style>')[0];
test('Aurora composer keeps a visible keyboard focus', () => {
  assert.ok(aurora, 'Aurora CSS must be shipped in UI');
  assert.match(aurora, /#composer #input:focus-visible\s*\{[^}]*outline:/);
  assert.match(aurora, /#composer #send:focus-visible\s*\{[^}]*outline:/);
});
test('Aurora composer supports narrow mobile viewports', () => {
  assert.match(aurora, /@media\(max-width:600px\)/);
  assert.match(aurora, /#composer #input\s*\{font-size:16px/);
  assert.match(aurora, /env\(safe-area-inset-bottom\)/);
});
test('Aurora honors reduced motion preferences', () => {
  assert.match(aurora, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(aurora, /transition:none!important/);
  assert.match(aurora, /transform:none/);
});
test('Send button preserves the Phoenix circular control contract', () => {
  assert.match(aurora, /#composer #send\{width:44px;min-width:44px;height:44px;min-height:44px/);
  assert.match(aurora, /#composer #send\{width:44px;min-width:44px;padding:0/);
});
