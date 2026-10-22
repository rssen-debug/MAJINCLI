import test from 'node:test';
import assert from 'node:assert/strict';
import { safeParse } from '../src/core/loop.js';

test('safeParse handles valid structured tool arguments', () => {
  assert.deepEqual(safeParse('{"count":2,"enabled":true}'), { count:2, enabled:true });
});
test('safeParse recovers a malformed escape without throwing', () => {
  assert.doesNotThrow(() => safeParse('name: "bad\\\\q", count: 2'));
  assert.deepEqual(safeParse('name: "bad\\\\q", count: 2'), { name:'bad\\q',count:2 });
});
test('safeParse retains numeric and boolean fallback arguments', () => {
  assert.deepEqual(safeParse('count: 3, enabled: false'), { count:3,enabled:false });
});
