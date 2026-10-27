#!/usr/bin/env node
/**
 * MAJIN V5 OpenCode launcher with opt-in, metadata-only GitHub debug PRs.
 * No chat, environment variables, file paths, CVs, tool arguments or stdout
 * are collected. This is an outer wrapper, not MAJIN's internal tool tracer.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function safeReport({ exitCode, startedAt, endedAt }) {
  return {
    schema: 'majin.debug.v1',
    source: 'opencode-wrapper',
    status: exitCode === 0 ? 'completed' : 'failed',
    exit_code: Number.isInteger(exitCode) ? exitCode : -1,
    start_utc: new Date(startedAt).toISOString(),
    end_utc: new Date(endedAt).toISOString(),
    duration_seconds: Math.max(0, Math.floor((endedAt - startedAt) / 1000)),
    note: 'Metadata only. No prompts, CVs, log output or tool arguments collected.'
  };
}

function exec(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', stdio: 'pipe', ...options });
}
function checked(command, args, options = {}) {
  const result = exec(command, args, options);
  if (result.error || result.status !== 0) {
    throw new Error(command + ' failed: ' + (result.error?.message || (result.stderr || '').slice(0, 300)));
  }
  return result.stdout?.trim() || '';
}
function root() {
  return path.resolve(import.meta.dirname, '../..');
}
function storage() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'MAJIN', 'v5', 'debug-reporter');
}
function permissionFile() { return path.join(storage(), 'enabled'); }
function saveReport(report) {
  const dest = path.join(storage(), 'pending');
  fs.mkdirSync(dest, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json';
  const filename = path.join(dest, name);
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return filename;
}
function publishPending() {
  const pending = path.join(storage(), 'pending');
  if (!fs.existsSync(pending)) return 0;
  const files = fs.readdirSync(pending).filter(n => /^[\w-]+\.json$/.test(n));
  if (!files.length) return 0;
  checked('gh', ['auth', 'status']);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-debug-'));
  const branch = 'debug/metadata-' + Date.now() + '-' + randomUUID().slice(0, 8);
  try {
    checked('gh', ['repo', 'clone', 'rssen-debug/MAJINCLI', tmp, '--', '--quiet']);
    checked('git', ['checkout', '-b', branch], { cwd: tmp });
    const destination = path.join(tmp, 'debug-reports');
    fs.mkdirSync(destination, { recursive: true });
    for (const filename of files) {
      const parsed = JSON.parse(fs.readFileSync(path.join(pending, filename), 'utf8'));
      // Rebuild with ONLY explicit safe fields, even if outbox was modified.
      if (parsed.schema !== 'majin.debug.v1') continue;
      const sanitized = safeReport({
        exitCode: parsed.exit_code,
        startedAt: Date.parse(parsed.start_utc),
        endedAt: Date.parse(parsed.end_utc)
      });
      fs.writeFileSync(path.join(destination, filename), JSON.stringify(sanitized, null, 2) + '\n');
    }
    if (!fs.readdirSync(destination).length) return 0;
    checked('git', ['add', 'debug-reports'], { cwd: tmp });
    checked('git', ['-c', 'user.name=MAJIN Debug Reporter', '-c', 'user.email=debug-reporter@users.noreply.github.com', 'commit', '-m', 'chore(debug): sanitized session metadata'], { cwd: tmp });
    checked('git', ['push', '-u', 'origin', branch], { cwd: tmp });
    checked('gh', ['pr', 'create', '--repo', 'rssen-debug/MAJINCLI', '--base', 'main', '--head', branch, '--title', 'debug: metadata-only OpenCode session report', '--body', 'Opt-in debug report. Only exit code, timing, generic status and schema are included. No chat logs, prompts, CVs, tokens, secrets, environment values or file paths. Review before merging.'], { cwd: tmp });
    for (const filename of files) fs.rmSync(path.join(pending, filename), { force: true });
    return files.length;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const operation = process.argv[2];
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    if (operation === '--enable') {
      fs.mkdirSync(storage(), { recursive: true });
      fs.writeFileSync(permissionFile(), 'enabled\n', { mode: 0o600 });
      console.log('Opt-in enabled. Only sanitized metadata will be uploaded to GitHub PRs.');
    } else if (operation === '--disable') {
      fs.rmSync(permissionFile(), { force: true });
      console.log('Automatic GitHub upload disabled.');
    } else if (operation === '--status') {
      console.log('Auto-upload: ' + (fs.existsSync(permissionFile()) ? 'enabled' : 'disabled'));
      console.log('Pending reports: ' + (fs.existsSync(path.join(storage(), 'pending')) ? fs.readdirSync(path.join(storage(), 'pending')).filter(x=>x.endsWith('.json')).length : 0));
    } else if (operation === '--flush') {
      if (!fs.existsSync(permissionFile())) throw new Error('Upload is disabled. Run --enable first.');
      console.log('Uploaded reports: ' + publishPending());
    } else if (operation === '--run') {
      const startedAt = Date.now();
      const binary = process.platform === 'win32' ? 'opencode.cmd' : 'opencode';
      const outcome = spawnSync(binary, [], { stdio: 'inherit', shell: process.platform === 'win32' });
      const exitCode = Number.isInteger(outcome.status) ? outcome.status : 1;
      const filename = saveReport(safeReport({ exitCode, startedAt, endedAt: Date.now() }));
      console.log('Safe debug metadata saved locally.');
      if (fs.existsSync(permissionFile())) {
        try { console.log('Uploaded reports: ' + publishPending()); }
        catch (error) { console.error('GitHub upload pending: ' + error.message); }
      } else console.log('GitHub upload disabled. Use --enable to opt in.');
      process.exitCode = exitCode;
    } else {
      console.log('Usage: node scripts/v5/opencode-debug.mjs --enable|--disable|--status|--flush|--run');
    }
  } catch (error) {
    console.error('Debug reporter: ' + error.message);
    process.exitCode = 1;
  }
}
