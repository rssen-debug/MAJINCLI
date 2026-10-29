import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectInventory } from '../../src/v6/inventory.js';
import { ALL_TOOLS } from '../../src/core/tools/index.js';
import { browserTools } from '../../src/core/tools/browser.js';
import { desktopAppTools } from '../../src/core/tools/desktop-app.js';
import { ALL_MCP_TOOLS } from '../../src/v6/mcp.js';
import { parseArgs } from '../../src/v6/cli.js';

const read = (file) => fs.readFileSync(path.resolve(file), 'utf8');

test('the Windows launcher is dry-run capable and never mutates OpenCode, V5 or installs software', () => {
  const start = read('scripts/v6/start-v6.ps1');
  assert.match(start, /\[switch\]\$DryRun/);
  assert.match(start, /ValidateSet\('Doctor', 'Status', 'Worker', 'Inventory', 'Config'\)/);
  assert.match(start, /Refusing to run: the V6 home must not be the V5 data directory/);
  assert.match(start, /switch \(\$Action\)/);
  assert.match(start, /'Config' \{/);
  assert.match(start, /timeout\s*=\s*300000/);
  assert.doesNotMatch(start, /npm\s+(install|ci|i)\b/i);
  assert.doesNotMatch(start, /opencode\s+(auth|run|upgrade)\b/i);
  assert.doesNotMatch(start, /Set-Content[^\n]*opencode/i);
  assert.doesNotMatch(start, /C:\\MAJINCLI/i);
  assert.doesNotMatch(start, /-ExecutionPolicy\s+Bypass\s+-Command/i);
});

test('the registration script backs up, verifies and refuses JSONC instead of destroying it', () => {
  const register = read('scripts/v6/register-opencode-mcp.ps1');
  assert.match(register, /\[switch\]\$Apply/);
  assert.match(register, /Copy-Item -LiteralPath \$configFull -Destination \$backup/);
  assert.match(register, /ConvertFrom-Json/);
  assert.match(register, /Backup was not created/);
  assert.match(register, /JSONC configs are not edited automatically/);
  assert.match(register, /restored from \$backup/);
  assert.match(register, /DRY RUN\. Nothing was written/);
  assert.match(register, /mcp\['majin'\] = \$entry/);
  assert.doesNotMatch(register, /Remove-Item -LiteralPath \$configFull -Force\s*$/m);
  assert.doesNotMatch(register, /opencode\s+auth/i);
});

test('V6 never shells out to the GitHub CLI or rewrites the active installation', () => {
  const files = fs.readdirSync('src/v6', { recursive: true })
    .filter((file) => String(file).endsWith('.js'))
    .map((file) => path.join('src/v6', file));
  for (const file of files) {
    const content = read(file);
    assert.doesNotMatch(content, /\bgh\.exe\b/i, `${file} must not invoke gh.exe`);
    assert.doesNotMatch(content, /exec(Sync|File)?\([^)]*\bgh\b/, `${file} must not invoke gh`);
    assert.doesNotMatch(content, /npm\s+(install|ci)\s+-g/i, `${file} must not install global packages`);
  }
  const network = files.filter((file) => /\bfetch(Impl)?\s*\(/.test(read(file))).map((file) => path.basename(file)).sort();
  assert.deepEqual(network, ['agent.js', 'gmail.js', 'portal.js', 'relay.js', 'sync.js'],
    'network access is limited to Gmail, the private sync API and the Arena relay/portal transports');
  // Each networked module must carry its own guard: no generic "fetch whatever URL" path.
  assert.match(read('src/v6/arena/relay.js'), /redirect:\s*'error'/, 'relay must refuse redirects');
  assert.match(read('src/v6/jobs/portal.js'), /servesOrigin|allowOrigin/, 'portal must check the employer origin');
  assert.match(read('src/v6/arena/server.js'), /127\.0\.0\.1|loopback/i, 'the bridge must stay on loopback');
});

test('the Arena bridge script is dry-run capable, loopback-only and never elevates', () => {
  const bridge = read('scripts/v6/start-arena-bridge.ps1');
  assert.match(bridge, /\[ValidateSet\('Init', 'Doctor', 'Start', 'Status', 'Serve', 'Poll', 'Relay', 'Watch', 'Task', 'Provider', 'Plan', 'Mission', 'InstallTask', 'UninstallTask'\)\]/);
  assert.match(bridge, /'Mission' \{/, 'the autonomous loop needs a single entry point');
  assert.match(bridge, /\[switch\]\$AllowIrreversible/, 'irreversible work must be an explicit switch');
  assert.match(bridge, /\[switch\]\$Resume/, 'a stopped mission must be resumable');
  assert.match(bridge, /'Start' \{/, 'there must be a single command that checks and then starts');
  assert.match(bridge, /The bridge was NOT started/, 'Start must refuse to listen when the doctor fails');
  assert.match(bridge, /'Relay' \{/, 'outbound polling must be a first-class action');
  assert.match(bridge, /'Watch' \{/, 'the live view must be reachable from the same script');
  assert.match(bridge, /\[switch\]\$DryRun/);
  assert.match(bridge, /-RunLevel Limited/, 'the scheduled task must not run elevated');
  assert.match(bridge, /Refusing to run: the V6 home must not be the V5 data directory or inside it/);
  assert.match(bridge, /Refusing to run: the V5 data directory must not be inside the V6 home/);
  assert.match(bridge, /\(job\.submit\) stays disabled until you enable it deliberately/);
  assert.match(bridge, /if \(-not \$Apply\)/, 'registering or removing a scheduled task requires -Apply');
  assert.match(bridge, /Format-Argument/, 'scheduled task arguments must be quoted for paths with spaces');
  assert.match(bridge, /\| Out-Host/, 'child output must not leak into the function return value');
  assert.doesNotMatch(bridge, /C:\\MAJINCLI[^']*\$/, 'the protected install may only appear as a refusal guard');
  assert.doesNotMatch(bridge, /npm\s+(install|ci|i)\b/i);
  assert.doesNotMatch(bridge, /opencode\s+(auth|run|upgrade)\b/i);
  assert.doesNotMatch(bridge, /Register-ScheduledTask[^\n]*-RunLevel Highest/);
});

test('the calculated inventory matches the real registries', async () => {
  const inventory = await collectInventory({ deep: false, history: false });
  const expected = new Set([...ALL_TOOLS, ...browserTools, ...desktopAppTools].map((tool) => tool.name));
  assert.equal(inventory.counts.currentV1Entries, expected.size);
  assert.equal(inventory.counts.currentV1Universe, expected.size);
  assert.equal(inventory.counts.openCodeMcpTools, ALL_MCP_TOOLS.length);
  assert.equal(inventory.counts.openCodeDriverAdapters, null);
  assert.equal(inventory.deep.state, 'NOT_TESTED');
  assert.equal(inventory.tools.length, expected.size);
  assert.ok(inventory.tools.every((tool) => tool.name && tool.lane));
  assert.ok(inventory.tools.every((tool) => tool.executableOnHost === true || Boolean(tool.unavailableReason)));
});


test('CLI parsing does not let boolean flags swallow the command or option values', () => {
  const one = parseArgs(['status', '--json']);
  assert.deepEqual(one.positional, ['status']);
  assert.equal(one.flags.json, true);
  const two = parseArgs(['--v6-home=/tmp/v6', 'queue', 'add', '--kind', 'tool', '--json']);
  assert.deepEqual(two.positional, ['queue', 'add']);
  assert.equal(two.flags['v6-home'], '/tmp/v6');
  assert.equal(two.flags.kind, 'tool');
  assert.equal(two.flags.json, true);
  const three = parseArgs(['--json', 'status']);
  assert.deepEqual(three.positional, ['status'], 'a boolean flag must not consume the command');
  assert.equal(three.flags.json, true);
});
