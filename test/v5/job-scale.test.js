import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { benchmarkJobBatch } from '../../scripts/v5/benchmark-job-batch.mjs';

test('job scale benchmark completes distinct ads, retries transient errors and resumes idempotently', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-job-scale-'));
  const report = await benchmarkJobBatch({ count: 1200, dataDir, errorEvery: 100 });
  assert.equal(report.ok, true);
  assert.equal(report.count, 1200);
  assert.equal(report.first.errors, 12);
  assert.equal(report.recovery.processed, 12);
  assert.equal(report.stable.processed, 0);
  assert.equal(report.stable.matched, 1200);
  assert.equal(report.paidModelCalls, 0);
  assert.equal(report.applicationSubmissions, 0);
});
