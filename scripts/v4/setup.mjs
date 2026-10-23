#!/usr/bin/env node
/**
 * MAJIN V4 — the one setup command.
 *
 *   npm run v4:setup             do everything that can be done safely, print what is left
 *   npm run v4:setup -- --check  only report, change nothing
 *
 * The point is that the owner runs ONE command on Windows, once, and every
 * subsequent update arrives through the app instead of a terminal. This command
 * is therefore split into what it can do alone and what only the owner can do:
 *
 *   IT DOES
 *     - check the runtime, the data dir and the workspace
 *     - create the pairing record and show the code once
 *     - seed Owner Mode with the read-only network lanes
 *     - pin the release key, if one is provided (MAJIN_V4_RELEASE_KEY_PUB)
 *     - register the per-user logon task, if asked (--autostart)
 *     - run the doctor and print exactly what is missing
 *
 *   IT CANNOT
 *     - create your Cloudflare/Tailscale tunnel (needs your account)
 *     - grant files/shell/desktop (that is the phone's job, on purpose)
 *     - sign a release (needs the private key, which never lives here)
 *
 * Everything it prints is either done or explicitly the owner's next step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/v4/config.js';
import { ensurePairing, loadSecret, pairingExists } from '../../src/v4/auth.js';
import { OwnerMode } from '../../src/v4/owner-mode.js';
import { pinKey, readPinnedKey, UPDATER_SCHEMA } from '../../src/v4/updater.js';

const args = process.argv.slice(2);
const check = args.includes('--check');
const autostart = args.includes('--autostart');
const config = loadConfig({ argv: args });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const steps = [];
const record = (id, ok, detail, next = null) => steps.push({ id, ok, detail, next });

function line(t = '') {
  process.stdout.write(`${t}\n`);
}

/* 1. runtime ------------------------------------------------------------- */
const major = Number(process.versions.node.split('.')[0]);
record('node', major >= 22, `Node ${process.versions.node} (>= 22 required)`, major >= 22 ? null : 'Install Node 22 LTS, then run this again.');

/* 2. data dir + workspace ------------------------------------------------ */
function writable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const probe = path.join(dir, `.setup-${process.pid}`);
    fs.writeFileSync(probe, 'x', { mode: 0o600 });
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}
record('data', writable(config.paths.root), config.paths.root, 'Check permissions for %LOCALAPPDATA%\\MAJIN.');
record('workspace', writable(config.workspaceDir), config.workspaceDir, 'Set MAJIN_V4_WORKSPACE to a folder you own.');

/* 3. pairing ------------------------------------------------------------- */
if (!check) {
  const secret = loadSecret(config.paths.secret);
  const code = ensurePairing(config.paths.pairing, secret);
  record('pairing', true, code ? 'a new pairing code was issued (shown once, below)' : 'a pairing code already exists', code ? null : 'Run `npm run v4:pair -- --rotate` for a new code.');
  if (code) {
    line('');
    line('  ┌──────────────────────────────────────────────┐');
    line(`  │  Parkod: ${code.padEnd(36)}│`);
    line('  │  Skriv in den i telefonen. Visas bara nu.    │');
    line('  └──────────────────────────────────────────────┘');
  }
} else {
  record('pairing', pairingExists(config.paths.pairing), 'a pairing code exists', 'Run setup without --check to create one.');
}

/* 4. owner mode seed ----------------------------------------------------- */
const ownerFile = path.join(config.paths.root, 'owner-mode.json');
const owner = new OwnerMode({ file: ownerFile });
if (!check && !owner.enabled()) {
  owner.grant({ lanes: ['web', 'research', 'jobs'], reason: 'setup' });
  record('owner-mode', true, 'granted web, research and jobs (read-only network lanes)', null);
} else if (owner.enabled()) {
  record('owner-mode', true, `${owner.activeLanes().length} lane(s) already granted`, null);
} else {
  record('owner-mode', false, 'nothing granted yet', 'Run setup without --check to grant the read-only lanes.');
}
record('owner-extra', true, 'files, shell and desktop are granted from the phone (Permissions panel)', null);

/* 5. release key --------------------------------------------------------- */
const keyFile = path.join(config.paths.root, 'release-key.json');
const keySource = process.env.MAJIN_V4_RELEASE_KEY_PUB || path.join(root, 'release-public-key.pem');
if (!check && fs.existsSync(keySource) && !readPinnedKey(keyFile)) {
  pinKey(keyFile, fs.readFileSync(keySource, 'utf8'));
  record('release-key', true, `pinned from ${keySource}`, null);
} else if (readPinnedKey(keyFile)) {
  record('release-key', true, 'a release key is pinned; updates can be verified', null);
} else {
  record('release-key', false, 'no release key pinned; automatic updates stay off', 'Put the release public key at release-public-key.pem and run setup again, or set MAJIN_V4_RELEASE_KEY_PUB.');
}

/* 6. autostart ----------------------------------------------------------- */
if (process.platform === 'win32' && autostart && !check) {
  const ps = path.join(root, 'scripts', 'v4', 'install-v4-windows.ps1');
  const res = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps, '-AutoStart', '-Port', String(config.port)], { stdio: 'inherit' });
  record('autostart', res.status === 0, res.status === 0 ? 'logon task registered' : 'the installer returned an error', res.status === 0 ? null : 'Run: powershell -ExecutionPolicy Bypass -File .\\scripts\\v4\\install-v4-windows.ps1 -AutoStart');
} else if (process.platform === 'win32') {
  record('autostart', false, 'not requested', 'Add --autostart to register the per-user logon task.');
} else {
  record('autostart', false, `not applicable on ${process.platform}`, 'This runs on the Windows host.');
}

/* 7. model route --------------------------------------------------------- */
const model = config.model;
record('model', model.kind !== 'demo', model.kind === 'demo' ? 'no provider configured; MAJIN runs in demo mode' : `${model.label} · ${model.model}`,
  model.kind === 'demo' ? 'Configure a provider in the MAJIN config (or MAJIN_V4_BASE_URL/API_KEY/MODEL).' : null);

/* 8. tunnel -------------------------------------------------------------- */
record('tunnel', Boolean(config.publicOrigin), config.publicOrigin || 'no public origin configured',
  config.publicOrigin ? null : 'Set up the tunnel once (docs/v4/DEPLOYMENT.md §3-4), then set MAJIN_V4_PUBLIC_ORIGIN.');

/* report ----------------------------------------------------------------- */
const passed = steps.filter((s) => s.ok).length;
line('');
line('MAJIN V4 setup');
line('='.repeat(66));
for (const s of steps) {
  line(`  ${s.ok ? 'OK  ' : 'TODO'}  ${s.id.padEnd(12)} ${s.detail}`);
  if (!s.ok && s.next) line(`        → ${s.next}`);
}
line('-'.repeat(66));
line(`  ${passed}/${steps.length} automated steps done${check ? ' (check only: nothing was changed)' : ''}`);
line('');
const blocking = steps.filter((s) => !s.ok && ['node', 'data', 'workspace'].includes(s.id));
if (blocking.length) {
  line('  Fix the blocking steps above, then run setup again.');
} else if (!check) {
  line('  Next: npm run v4');
  line('  Then open the URL on the phone, enter the code, and turn on what you need in Permissions.');
  line('  Verify the whole chain any time with: npm run v4:accept -- --url https://<your-address>');
}
line('');
process.exitCode = blocking.length ? 1 : 0;
void UPDATER_SCHEMA;
