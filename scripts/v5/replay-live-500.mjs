#!/usr/bin/env node
/** Replay the real 500-ad fixture through a running MAJIN V5 HTTP server. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function replayLive500({
  server = 'http://127.0.0.1:4555',
  inputFile = path.join(process.cwd(), 'test', 'fixtures', 'majin-v5-live-500-input.json'),
  cvFile = path.join(process.cwd(), 'test', 'fixtures', 'synthetic-test-cv.txt'),
  outputFile = path.join(process.cwd(), '.majin', 'v5', 'live-500', 'replay-response.json'),
  limit = 500,
} = {}) {
  const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
  if (!Array.isArray(input.hits)) throw new Error('Replay input has no hits array');
  const cvText = fs.readFileSync(cvFile, 'utf8');
  const jobAds = input.hits.slice(0, Math.max(1, Math.min(500, Math.floor(limit))));
  const response = await fetch(`${server.replace(/\/$/, '')}/api/v5/goal`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      goalText: 'Replay real public ads with a synthetic CV. Match only; never contact employers or submit.',
      files: [{ name: 'synthetic-test-cv.txt', type: 'text/plain', data: Buffer.from(cvText).toString('base64') }],
      jobAds,
      criteria: { maxTarget: jobAds.length, locations: [] },
      mandate: { allowSubmit: false, prepareApplications: false },
    }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await response.text();
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(outputFile, text, { mode: 0o600 });
  const body = JSON.parse(text);
  const goal = body.goal || body;
  if (!response.ok || !goal.workflowSummary) throw new Error(`V5 replay failed: ${body.error || response.status}`);
  return {
    ok: true,
    httpStatus: response.status,
    goalId: goal.goal_id,
    goalStatus: goal.status,
    counters: goal.workflowSummary.counters,
    mandate: goal.workflowSummary.mandate,
    evidenceCount: goal.verification_evidence?.length || 0,
    outputFile,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const read = (flag, fallback = null) => {
    const index = argv.indexOf(flag);
    return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
  };
  const report = await replayLive500({
    server: read('--server', 'http://127.0.0.1:4555'),
    inputFile: path.resolve(read('--input', path.join(process.cwd(), 'test', 'fixtures', 'majin-v5-live-500-input.json'))),
    cvFile: path.resolve(read('--cv', path.join(process.cwd(), 'test', 'fixtures', 'synthetic-test-cv.txt'))),
    outputFile: path.resolve(read('--output', path.join(process.cwd(), '.majin', 'v5', 'live-500', 'replay-response.json'))),
    limit: Number(read('--limit', '500')),
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.stack || err?.message || err);
    process.exitCode = 1;
  });
}
