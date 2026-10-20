import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSync, startJob, listBackends } from '../src/core/executors.js';
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-w3-win-'));
test('W3 Windows: local PowerShell command and durable evidence', async () => {
  assert.equal(process.platform, 'win32');
  const result = await runSync({ backend: 'local', command: "Write-Output 'MAJIN-W3-WINDOWS-OK'", timeoutSec: 20 }, { workspace });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.io.stdout, /MAJIN-W3-WINDOWS-OK/);
  assert.ok(fs.existsSync(result.paths.stdout));
  assert.ok(fs.existsSync(path.join(result.paths.metaDir, 'meta.json')));
});
test('W3 Windows: nonzero exit is failure', async () => {
  const result = await runSync({ backend: 'local', command: 'exit 13', timeoutSec: 20 }, { workspace });
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 13);
});
test('W3 Windows: timeout terminates work', async () => {
  const result = await runSync({ backend: 'local', command: 'Start-Sleep -Seconds 20', timeoutSec: 1 }, { workspace });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
});
test('W3 Windows: unknown backend and missing SSH host never execute locally', () => {
  assert.equal(startJob({backend:'unknown',command:'echo BAD'}, {workspace}).error.code, 'backend_unknown');
  assert.equal(startJob({backend:'ssh',command:'echo BAD'}, {workspace}).error.code, 'ssh_host_required');
});
test('W3 Windows: Docker availability is measured; missing image rejected', () => {
  const backends = listBackends();
  const out = startJob({backend:'docker',command:'echo BAD'}, {workspace});
  assert.equal(out.ok,false);
  assert.equal(out.error.code, backends.docker.available ? 'docker_image_required' : 'docker_unavailable');
});
