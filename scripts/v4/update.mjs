#!/usr/bin/env node
/**
 * MAJIN V4 — updater CLI.
 *
 *   node scripts/v4/update.mjs check           what is available (no changes)
 *   node scripts/v4/update.mjs apply           verify, stage, activate, restart
 *   node scripts/v4/update.mjs apply --allow-unsigned   local testing only
 *
 * Where it looks: a GitHub release asset by default, overridable with
 * MAJIN_V4_RELEASE_URL. The manifest must be signed by the key pinned at
 * install time (`release-key.json` next to the data dir).
 *
 * Nothing here touches git. An update is a signed release, not a branch.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../src/v4/config.js';
import {
  UPDATER_SCHEMA, UpdateError, planUpdate, readPinnedKey, runUpdate,
} from '../../src/v4/updater.js';

const args = process.argv.slice(2);
const cmd = args[0] || 'check';
const flag = (n) => args.includes(n);
const config = loadConfig();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const liveDir = root;
const stagingDir = path.join(config.paths.root, 'release-staging');
const backupDir = path.join(config.paths.root, 'release-previous');
const keyFile = path.join(config.paths.root, 'release-key.json');
const versionFile = path.join(root, 'package.json');

function line(t = '') {
  process.stdout.write(`${t}\n`);
}

function currentVersion() {
  try {
    return JSON.parse(fs.readFileSync(versionFile, 'utf8')).version;
  } catch {
    return null;
  }
}

/** Fetch the manifest and signature for the configured release. */
async function fetchRelease() {
  const base = process.env.MAJIN_V4_RELEASE_URL;
  if (!base) {
    throw new UpdateError(
      'NO_RELEASE_URL',
      'no release channel configured. Set MAJIN_V4_RELEASE_URL to the release asset base '
      + '(the folder that holds manifest.json and manifest.sig), or use `npm run v4:upgrade` for a git checkout.',
    );
  }
  const get = async (name) => {
    const url = `${base.replace(/\/+$/, '')}/${name}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new UpdateError('FETCH_FAILED', `${url} -> HTTP ${res.status}`);
    return res;
  };
  const manifest = await (await get('manifest.json')).json();
  const signature = (await (await get('manifest.sig')).text()).trim();
  return {
    manifest,
    signature,
    readFile: async (p) => {
      const res = await get(p.replace(/^\/+/, ''));
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

async function restartHost() {
  // The supervisor owns the host process; a restart is a health-checked signal.
  const health = process.env.MAJIN_V4_HEALTH_URL || `http://127.0.0.1:${config.port}/api/health`;
  try {
    const res = await fetch(health, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  line('');
  line('MAJIN V4 update');
  line('='.repeat(60));
  line(`  current version: ${currentVersion() || 'unknown'}`);
  line(`  release key:     ${readPinnedKey(keyFile) ? 'pinned' : 'NOT PINNED'}`);
  line('');

  if (keyFile && !readPinnedKey(keyFile) && !flag('--allow-unsigned')) {
    line('  No release key is pinned, so no release can be trusted.');
    line('  Pin one once at install time:  npm run v4:pin-release-key -- <public-key.pem>');
    line('');
    process.exitCode = 1;
    return;
  }

  let release;
  try {
    release = await fetchRelease();
  } catch (err) {
    line(`  ${err.code || 'ERROR'}: ${err.message}`);
    line('');
    process.exitCode = 1;
    return;
  }

  const publicKey = readPinnedKey(keyFile);
  let plan;
  try {
    plan = planUpdate({
      manifest: release.manifest,
      signature: release.signature,
      publicKey,
      currentVersion: currentVersion(),
      allowUnsigned: flag('--allow-unsigned'),
    });
  } catch (err) {
    line(`  REFUSED (${err.code}): ${err.message}`);
    line('');
    process.exitCode = 1;
    return;
  }

  line(`  available: ${plan.action === 'noop' ? 'nothing (already current)' : `${plan.version} (${plan.files} files, ${Math.round(plan.bytes / 1024)} kB)`}`);
  if (plan.unsigned) line('  WARNING: this release is unsigned and was explicitly allowed.');
  line('');

  if (cmd === 'check' || plan.action === 'noop') {
    line('  nothing was changed.');
    line('');
    return;
  }

  if (cmd !== 'apply') {
    line('  run `node scripts/v4/update.mjs apply` to install it.');
    line('');
    return;
  }

  // fetchRelease reads through the network; runUpdate wants sync bytes, so the
  // files are pulled first and cached in memory. A release is small by design.
  const cache = new Map();
  for (const entry of release.manifest.files) cache.set(entry.path, await release.readFile(entry.path));

  const result = await runUpdate({
    manifest: release.manifest,
    signature: release.signature,
    publicKey,
    currentVersion: currentVersion(),
    liveDir,
    stagingDir,
    backupDir,
    readFile: (p) => cache.get(p),
    restartHost,
    allowUnsigned: flag('--allow-unsigned'),
    log: (event, detail) => line(`  [${event}] ${JSON.stringify(detail)}`),
  });

  line('');
  switch (result.status) {
    case 'UPDATED':
      line(`  Updated to ${result.version}. The host was restarted and answered its health check.`);
      break;
    case 'ROLLED_BACK':
      line(`  ${result.version} failed its health check. The previous version is running again.`);
      break;
    case 'NOOP':
      line('  Already current.');
      break;
    default:
      line(`  ${result.status}: ${result.reason || 'see the log above'}`);
      break;
  }
  line('');
  process.exitCode = result.status === 'UPDATED' || result.status === 'NOOP' ? 0 : 1;
}

await main();
void UPDATER_SCHEMA;
