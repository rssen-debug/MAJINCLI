import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/ui/phoenix.css', import.meta.url), 'utf8');

test('working agent status is not hidden', () => {
  assert.doesNotMatch(css, /body:is\(\[data-run-state=connecting\].*?#status\s*\{\s*visibility:hidden\s*\}/s);
  assert.match(css, /#status\s*\{\s*visibility:visible;/);
});

test('active status uses reduced-motion-safe subtle indicator', () => {
  assert.match(css, /#status::before\s*\{/);
  assert.match(css, /@media\(prefers-reduced-motion:no-preference\)/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});
