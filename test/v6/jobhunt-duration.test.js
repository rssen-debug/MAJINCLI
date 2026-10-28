import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, formatDuration } from '../../src/v6/jobhunt/duration.js';

test('duration parser accepts m, h and d with dynamic long values', () => {
  assert.equal(parseDuration('30m').ms, 30 * 60 * 1000);
  assert.equal(parseDuration('60m').ms, 60 * 60 * 1000);
  assert.equal(parseDuration('120m').ms, 120 * 60 * 1000);
  assert.equal(parseDuration('320m').ms, 320 * 60 * 1000);
  assert.equal(parseDuration('10000m').ms, 10000 * 60 * 1000);
  assert.equal(parseDuration('2h').ms, 2 * 60 * 60 * 1000);
  assert.equal(parseDuration('1d').ms, 24 * 60 * 60 * 1000);
  assert.equal(parseDuration('1d2h3m').ms, (24 * 60 * 60 + 2 * 60 * 60 + 3 * 60) * 1000);
  assert.equal(formatDuration(parseDuration('10000m').ms), '6d 22h 40m');
});

test('invalid and unsafe durations fail with explicit errors', () => {
  for (const value of ['0m', '0', '-5m', '1x', 'm', '   ', '999999999999999999999d']) {
    assert.throws(() => parseDuration(value), /duration/i, value);
  }
  assert.equal(parseDuration('10000m').parts.days, 6);
  assert.equal(parseDuration('320m').human, '5h 20m');
});
