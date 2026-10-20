import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

test('incomplete job turns cannot become successful reusable auto-skills', () => {
  const agent = fs.readFileSync(fileURLToPath(new URL('../src/core/agent.js', import.meta.url)), 'utf8');
  const gate = agent.match(/if \(cfg\.get\('skills\.auto'\)[^\n]+\) \{/)?.[0] || '';
  assert.match(gate, /!res\.incomplete/, 'step-limit exhaustion must not teach a false success');
  assert.match(gate, /!res\.blocked/, 'blocked tool loops must not be saved as successful skills');
  assert.match(gate, /!res\.aborted/, 'aborted turns must not be saved as successful skills');
  assert.match(gate, /res\.toolLog\?\.some\(\(t\) => t\.ok\)/, 'skill requires at least one successful tool');
});
