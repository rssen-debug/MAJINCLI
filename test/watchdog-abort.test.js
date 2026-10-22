import test from 'node:test';
import assert from 'node:assert/strict';
import { withTimeout } from '../src/core/watchdog.js';

test('watchdog returns results for successful work', async () => {
  assert.equal(await withTimeout(Promise.resolve('ok'), { ms: 300 }), 'ok');
});
test('watchdog honors a pre-aborted signal', async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(withTimeout(new Promise(() => {}), { ms: 1000, signal: ctrl.signal }), { code: 'aborted' });
});
test('watchdog cancels pending wait when user aborts', async () => {
  const ctrl = new AbortController();
  const task = withTimeout(new Promise(() => {}), { ms: 1000, signal: ctrl.signal });
  ctrl.abort();
  await assert.rejects(task, { code: 'aborted' });
});
test('watchdog preserves timeout error identity', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), { ms: 1, code: 'my_timeout' }), { code: 'my_timeout', timeoutMs: 250 });
});
