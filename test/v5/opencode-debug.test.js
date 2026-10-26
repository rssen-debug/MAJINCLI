import test from 'node:test';
import assert from 'node:assert/strict';
import { safeReport } from '../../scripts/v5/opencode-debug.mjs';

test('safe report strictly allowlists fields', () => {
  const report = safeReport({ exitCode: 0, startedAt: Date.parse('2026-10-26T10:00:00Z'), endedAt: Date.parse('2026-10-26T10:00:03Z'), prompt: 'PRIVATE CV SECRET', apiKey: 'SECRET' });
  assert.deepEqual(Object.keys(report), ['schema', 'source', 'status', 'exit_code', 'start_utc', 'end_utc', 'duration_seconds', 'note']);
  assert.equal(report.status, 'completed');
  assert.equal(report.duration_seconds, 3);
  assert.equal(JSON.stringify(report).includes('PRIVATE CV SECRET'), false);
});
test('failure is represented without capturing output', () => {
  const report = safeReport({ exitCode: 1, startedAt: 0, endedAt: 1_000, stderr: 'token=hidden' });
  assert.equal(report.status, 'failed');
  assert.equal(report.exit_code, 1);
  assert.equal(JSON.stringify(report).includes('token=hidden'), false);
});
