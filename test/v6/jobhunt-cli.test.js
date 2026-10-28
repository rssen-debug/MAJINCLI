import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main } from '../../src/v6/cli.js';

function capture() {
  const chunks = [];
  return {
    stream: { write: (value) => { chunks.push(String(value)); return true; } },
    text: () => chunks.join(''),
  };
}

test('jobhunt status is read-only and reports a missing session honestly', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobhunt-cli-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const out = capture();
  const err = capture();
  const code = await main(['jobhunt', 'status', '--json', '--v6-home', home], { stdout: out.stream, stderr: err.stream });
  assert.equal(code, 0);
  const parsed = JSON.parse(out.text());
  assert.equal(parsed.state, 'NONE');
});

test('an invalid duration is a clear usage error, not a crash', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-jobhunt-cli-bad-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const out = capture();
  const err = capture();
  const code = await main(['jobhunt', '0m', '--v6-home', home], { stdout: out.stream, stderr: err.stream });
  assert.equal(code, 1);
  assert.match(err.text(), /DURATION_ZERO/);
});
