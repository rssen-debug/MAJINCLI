import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readHistory, historyPath } from '../src/core/context.js';

test('history reader ignores malformed JSONL records but preserves valid order', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-history-'));
  try {
    fs.writeFileSync(historyPath('trial', dir), [
      JSON.stringify({ role: 'user', content: 'first' }),
      '{"role":"assistant",',
      'null',
      '[1,2]',
      JSON.stringify({ role: 'assistant', content: 'second' }),
    ].join('\n') + '\n');
    assert.deepEqual(readHistory('trial', 400, dir).map(m => m.content), ['first', 'second']);
    assert.deepEqual(readHistory('trial', 2, dir).map(m => m.content), ['second']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
