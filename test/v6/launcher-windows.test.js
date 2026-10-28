import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

test('Windows PowerShell launcher accepts installed Node and dry-run leaves state untouched', {
  skip: process.platform !== 'win32', timeout: 30000,
}, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin launcher spaces '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const v5 = path.join(root, 'v5');
  const v6 = path.join(root, 'v6');
  fs.mkdirSync(v5);
  const grants = '{"lanes":[]}';
  fs.writeFileSync(path.join(v5, 'owner-mode.json'), grants);
  const output = execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.resolve('scripts/v6/start-v6.ps1'),
    '-Action', 'Doctor', '-DryRun', '-Workspace', root,
    '-V5DataDir', v5, '-V6Home', v6,
  ], { encoding: 'utf8', timeout: 25000, windowsHide: true });
  assert.match(output, /\[DryRun\] doctor not executed/);
  assert.equal(fs.existsSync(v6), false);
  assert.equal(fs.readFileSync(path.join(v5, 'owner-mode.json'), 'utf8'), grants);
  assert.deepEqual(fs.readdirSync(root), ['v5']);
});
