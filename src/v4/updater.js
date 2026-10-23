/**
 * MAJIN V4 — signed-release updater.
 *
 * The requirement was explicit: approved releases install and activate without
 * the owner opening PowerShell again. That is only defensible if an update is
 * *provably* the release the owner approved — otherwise an auto-updater is a
 * remote code execution hole with a progress bar.
 *
 * The chain, and what makes each link trustworthy:
 *
 *   GitHub release  ->  a JSON manifest listing files with their SHA-256
 *   manifest        ->  detached Ed25519 signature by a key the owner pinned
 *                       at install time (public key on disk, private never here)
 *   files           ->  every file re-hashed after download; a mismatch aborts
 *                       the whole update before anything is written
 *   install         ->  staged beside the live tree, then swapped in one rename
 *   activation      ->  the supervisor restarts the host and health-checks it
 *   failure         ->  restore the previous directory and restart it
 *
 * What this deliberately does NOT do: it does not run `git pull`, it does not
 * accept a release without a signature, and it does not update itself. The
 * updater is a separate process precisely so a bad release cannot break the
 * thing that would fix it.
 *
 * Unsigned mode exists for a local test (`allowUnsigned`), is refused when a key
 * is pinned, and is recorded in the audit line so it cannot pass unnoticed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const UPDATER_SCHEMA = 'majin.v4.release/v1';
export const KEY_SCHEMA = 'majin.v4.release-key/v1';

export class UpdateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'UpdateError';
    this.code = code;
  }
}

/* --------------------------------------------------------------- keys ----- */

/** Write the public key the owner pinned. 0644 is fine: it is public. */
export function pinKey(file, publicKeyPem) {
  if (!/-----BEGIN PUBLIC KEY-----/.test(String(publicKeyPem))) {
    throw new UpdateError('BAD_KEY', 'that is not a PEM public key');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ schema: KEY_SCHEMA, pinnedAt: new Date().toISOString(), publicKey: publicKeyPem }, null, 2));
  fs.renameSync(tmp, file);
  return file;
}

export function readPinnedKey(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (data?.schema !== KEY_SCHEMA || typeof data.publicKey !== 'string') return null;
    return data.publicKey;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- manifests ---- */

/**
 * The exact bytes that are signed.
 *
 * A manifest is data; signing `JSON.stringify(parsed)` would make the signature
 * depend on key order and whitespace. The canonical form is the fields that
 * decide what gets installed, in a fixed order, with a fixed separator.
 */
export function canonicalManifest(manifest) {
  const files = [...(manifest.files || [])]
    .map((f) => ({ path: String(f.path), sha256: String(f.sha256).toLowerCase(), bytes: Number(f.bytes) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
  return [
    manifest.schema,
    manifest.version,
    manifest.commit,
    String(manifest.publishedAt || ''),
    ...files.map((f) => `${f.path}:${f.sha256}:${f.bytes}`),
  ].join('\n');
}

/** Verify a detached Ed25519 signature over the canonical manifest. */
export function verifyManifest(manifest, signatureB64, publicKeyPem) {
  if (manifest?.schema !== UPDATER_SCHEMA) throw new UpdateError('BAD_SCHEMA', `unknown manifest schema: ${manifest?.schema}`);
  if (!publicKeyPem) throw new UpdateError('NO_KEY', 'no release key is pinned on this machine');
  if (!signatureB64) throw new UpdateError('UNSIGNED', 'the release has no signature');
  let ok = false;
  try {
    ok = crypto.verify(
      null,
      Buffer.from(canonicalManifest(manifest), 'utf8'),
      crypto.createPublicKey(publicKeyPem),
      Buffer.from(String(signatureB64), 'base64'),
    );
  } catch (err) {
    throw new UpdateError('BAD_KEY', `could not verify the signature: ${err.message}`);
  }
  if (!ok) throw new UpdateError('BAD_SIGNATURE', 'the signature does not match this manifest');
  return true;
}

/** Sign a manifest (used by the release tooling, not by the host). */
export function signManifest(manifest, privateKeyPem) {
  return crypto.sign(null, Buffer.from(canonicalManifest(manifest), 'utf8'), crypto.createPrivateKey(privateKeyPem)).toString('base64');
}

/* ------------------------------------------------------------- install ---- */

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Walk a directory into `relative/path -> sha256` for the manifest. */
export function hashTree(dir, { skip = [] } = {}) {
  const out = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(dir, full).split(path.sep).join('/');
      if (skip.some((s) => rel === s || rel.startsWith(`${s}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const buf = fs.readFileSync(full);
        out.push({ path: rel, sha256: sha256(buf), bytes: buf.length });
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Decide whether a release may be applied, without touching the disk.
 * Returns a plan the caller can print, or throws with the reason.
 */
export function planUpdate({ manifest, signature, publicKey, currentVersion, allowUnsigned = false, allowDowngrade = false } = {}) {
  if (allowUnsigned && !signature) {
    if (publicKey) throw new UpdateError('REFUSED', 'a release key is pinned; an unsigned update is not allowed');
    if (manifest?.schema !== UPDATER_SCHEMA) throw new UpdateError('BAD_SCHEMA', 'unknown manifest schema');
  } else {
    verifyManifest(manifest, signature, publicKey);
  }

  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+/.test(manifest.version)) {
    throw new UpdateError('BAD_VERSION', `invalid version: ${manifest.version}`);
  }
  if (currentVersion && manifest.version === currentVersion) {
    return { action: 'noop', version: manifest.version, reason: 'already on this version' };
  }
  if (currentVersion && !allowDowngrade && compareVersions(manifest.version, currentVersion) < 0) {
    throw new UpdateError('DOWNGRADE_REFUSED', `${manifest.version} is older than ${currentVersion}`);
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  if (files.length === 0) throw new UpdateError('EMPTY_RELEASE', 'the release lists no files');
  return {
    action: 'install',
    version: manifest.version,
    commit: manifest.commit || null,
    files: files.length,
    bytes: files.reduce((n, f) => n + (Number(f.bytes) || 0), 0),
    unsigned: Boolean(allowUnsigned && !signature),
  };
}

export function compareVersions(a, b) {
  const norm = (v) => String(v).split(/[.-]/).slice(0, 3).map((n) => Number(n) || 0);
  const [a1, a2, a3] = norm(a);
  const [b1, b2, b3] = norm(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  return a3 - b3;
}

/**
 * Write a verified release into a staging directory.
 *
 * Every buffer is hashed BEFORE it is written, so a tampered file never lands on
 * disk at all — not even briefly.
 */
export function stageRelease({ manifest, readFile, stagingDir }) {
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
  const written = [];
  for (const entry of manifest.files) {
    const buf = readFile(entry.path);
    if (!buf || buf.length !== Number(entry.bytes)) {
      throw new UpdateError('SIZE_MISMATCH', `${entry.path}: expected ${entry.bytes} bytes`);
    }
    const got = sha256(buf);
    if (got !== String(entry.sha256).toLowerCase()) {
      throw new UpdateError('HASH_MISMATCH', `${entry.path}: hash does not match the manifest`);
    }
    const target = path.join(stagingDir, ...entry.path.split('/'));
    if (path.dirname(path.resolve(target)).startsWith(path.resolve(stagingDir)) === false) {
      throw new UpdateError('PATH_ESCAPE', `${entry.path} escapes the staging directory`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.writeFileSync(target, buf, { mode: 0o600 });
    written.push(entry.path);
  }
  return { stagingDir, files: written };
}

/**
 * Swap the staged release in, keeping the previous tree for rollback.
 *
 * Two renames, not a merge: the old tree is moved aside whole, the new one moved
 * in whole. A half-installed state is therefore impossible.
 */
export function activateRelease({ liveDir, stagingDir, backupDir }) {
  fs.rmSync(backupDir, { recursive: true, force: true });
  let movedOld = false;
  if (fs.existsSync(liveDir)) {
    fs.renameSync(liveDir, backupDir);
    movedOld = true;
  }
  try {
    fs.renameSync(stagingDir, liveDir);
  } catch (err) {
    if (movedOld) fs.renameSync(backupDir, liveDir);
    throw new UpdateError('ACTIVATE_FAILED', `could not activate the release: ${err.message}`);
  }
  return { liveDir, backupDir: movedOld ? backupDir : null };
}

/** Put the previous tree back. Used when the new host fails its health check. */
export function rollbackRelease({ liveDir, backupDir }) {
  if (!backupDir || !fs.existsSync(backupDir)) throw new UpdateError('NO_BACKUP', 'there is no previous release to roll back to');
  fs.rmSync(liveDir, { recursive: true, force: true });
  fs.renameSync(backupDir, liveDir);
  return { liveDir, restored: true };
}

/**
 * The whole update, with the injection points a test needs.
 *
 * `fetchManifest`, `fetchFile` and `restartHost` are supplied by the caller (the
 * CLI wires them to GitHub and the supervisor). Nothing here does network I/O
 * itself, so every branch is testable without a network.
 */
export async function runUpdate({
  manifest,
  signature,
  publicKey,
  currentVersion,
  liveDir,
  stagingDir,
  backupDir,
  readFile,
  restartHost,
  healthCheck,
  allowUnsigned = false,
  log = () => {},
} = {}) {
  const plan = planUpdate({ manifest, signature, publicKey, currentVersion, allowUnsigned });
  if (plan.action === 'noop') {
    log('noop', { version: plan.version });
    return { status: 'NOOP', ...plan };
  }
  log('planned', plan);

  const staged = stageRelease({ manifest, readFile, stagingDir });
  log('staged', { files: staged.files.length });

  const activated = activateRelease({ liveDir, stagingDir, backupDir });
  log('activated', { liveDir });

  let healthy = false;
  try {
    healthy = await restartHost();
  } catch (err) {
    log('restart_failed', { error: String(err?.message || err) });
    healthy = false;
  }
  if (healthy && typeof healthCheck === 'function') {
    try {
      healthy = await healthCheck();
    } catch {
      healthy = false;
    }
  }

  if (!healthy) {
    log('unhealthy', { version: plan.version });
    if (activated.backupDir) {
      rollbackRelease(activated);
      log('rolled_back', { to: currentVersion || null });
      try {
        await restartHost();
      } catch { /* the caller reports this */ }
      return { status: 'ROLLED_BACK', version: plan.version, reason: 'the new version failed its health check' };
    }
    return { status: 'FAILED', version: plan.version, reason: 'the new version failed and there was no previous release' };
  }

  log('updated', { version: plan.version, commit: plan.commit });
  return { status: 'UPDATED', version: plan.version, commit: plan.commit, unsigned: plan.unsigned };
}
