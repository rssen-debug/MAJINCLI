/**
 * Update checks against GitHub Releases.
 *
 * The rule that shapes this file: an update check may never be the reason
 * anything fails. A person on a plane, behind a proxy, or on a repo that was
 * renamed must get exactly the same MAJIN as everyone else, with one extra line
 * in the settings panel at most. So every entry point swallows its errors into a
 * `note` field, has a hard timeout, and writes nothing but the `updates` config
 * section.
 *
 * The endpoint is the GitHub REST API, not a MAJIN-owned server, because the
 * release page is already the source of truth for what exists: no extra hosting,
 * no second thing to keep alive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { load } from './config.js';

const DEFAULT_REPO = 'rssen-debug/MAJINCLI';
const LEGACY_REPO = 'rssen-debug/slurps'; // the archived first home -- never published a release
const ASSET = 'MAJIN-Setup.exe';
const TIMEOUT_MS = 8000;

export const SETUP_ASSET = ASSET;

export function repoSlug(cfg) {
  let raw = (cfg && cfg.get && cfg.get('updates.repo')) || DEFAULT_REPO;
  raw = String(raw).trim();
  // the project moved: a config written by an old version still points at the
  // archived repo (which has no releases, so the app looked "never outdated").
  // Move it to the new home once, persist, and carry on.
  if (raw === LEGACY_REPO) {
    raw = DEFAULT_REPO;
    try { if (cfg && cfg.set) cfg.set('updates.repo', DEFAULT_REPO); } catch { /* read-only */ }
  }
  const m = /^([\w.-]+)\/([\w.-]+)$/.exec(raw);
  if (m) return { owner: m[1], repo: m[2] };
  const d = DEFAULT_REPO.split('/');
  return { owner: d[0], repo: d[1] };
}

/** 'v0.1.2' / '0.1.2' -> [0,1,2] ; anything unparseable is the lowest thing there is. */
export function parseVersion(text) {
  const m = /v?(\d+)\.(\d+)\.(\d+)(?:-([\w.]+))?/.exec(String(text == null ? '' : text).trim());
  if (!m) return { major: 0, minor: 0, patch: 0, pre: '', raw: String(text || ''), ok: false };
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '', raw: m[0].replace(/^v/, ''), ok: true };
}

/** -1 when `a` is older, 0 equal, 1 newer. Pre-release sorts below the release. */
export function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (const k of ['major', 'minor', 'patch']) {
    if (x[k] !== y[k]) return x[k] > y[k] ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre > y.pre ? 1 : -1;
}

/** The one sentence the UI and the CLI both use, so they can never disagree. */
export function notice(info, current) {
  if (!info) return '';
  if (info.error) return info.silent ? '' : `update check failed: ${info.error}`;
  if (!info.latest) return '';
  if (compareVersions(current, info.latest) >= 0) return '';
  return `MAJIN ${info.latest} is available (you have ${current})`;
}

function releaseUrl(slug) {
  return `https://api.github.com/repos/${slug.owner}/${slug.repo}/releases/${slug.pre ? 'tags/' + slug.pre : 'latest'}`;
}

/**
 * @param {object} o
 * @param {object} o.cfg        config loader
 * @param {number} [o.now]
 * @param {function} [o.fetchImpl]  replaceable, which is how the test runs it
 * @param {boolean}  [o.force]   ignore the interval
 * @param {boolean}  [o.silent]  do not surface errors (the background check)
 */
export async function checkForUpdate(o = {}) {
  const cfg = o.cfg || load();
  const current = o.version || process.env.MAJIN_VERSION || '0.0.0';
  const conf = cfg.get('updates') || {};
  const now = o.now == null ? Date.now() : o.now;
  const cached = {
    checkedAt: conf.lastCheck || 0,
    latest: conf.latest || null,
    url: conf.url || null,
    notes: conf.notes || null,
    error: null,
    fromCache: true,
    current,
  };
  if (conf.check === false) return { ...cached, skipped: 'disabled', silent: true };
  const hours = Number(conf.intervalHours) > 0 ? Number(conf.intervalHours) : 24;
  if (!o.force && cached.checkedAt && now - cached.checkedAt < hours * 3600 * 1000) {
    return { ...cached, skipped: 'too soon' };
  }

  const slug = { ...repoSlug(cfg), pre: conf.channel === 'latest' ? '' : conf.channel || '' };
  const impl = o.fetchImpl || globalThis.fetch;
  let res;
  try {
    res = await impl(releaseUrl(slug), {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': `majin/${current} update-check`,
        ...(conf.token ? { authorization: `Bearer ${conf.token}` } : {}),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const info = { ...cached, error: err.name === 'TimeoutError' ? 'timed out' : err.message, checkedAt: cached.checkedAt, silent: true };
    if (!o.silent) write(cfg, { ...info, error: err.message }, now, current);
    return info;
  }
  if (res.status === 404) return { ...cached, error: 'no release published yet', checkedAt: now, silent: true };
  if (!res.ok) return { ...cached, error: `github said ${res.status}`, silent: true };
  let body;
  try {
    body = await res.json();
  } catch {
    return { ...cached, error: 'the release JSON could not be read', silent: true };
  }
  const assets = Array.isArray(body.assets) ? body.assets : [];
  const setup = assets.find((a) => a.name === SETUP_ASSET) || assets.find((a) => /\.exe$/i.test(a.name || ''));
  const info = {
    checkedAt: now,
    latest: String(body.tag_name || '').replace(/^v/, '') || null,
    url: body.html_url || null,
    notes: body.body ? String(body.body).slice(0, 2000) : null,
    asset: setup ? { name: setup.name, size: setup.size, browserUrl: setup.browser_download_url, id: setup.id } : null,
    publishedAt: body.published_at || null,
    error: null,
    fromCache: false,
    current,
  };
  if (!setup && info.latest && compareVersions(current, info.latest) < 0) {
    info.note = `the release page has no ${SETUP_ASSET}; only the source tag is published`;
  }
  write(cfg, info, now, current);
  return info;
}

function write(cfg, info, now, current) {
  const patch = {
    updates: {
      lastCheck: now,
      latest: info.latest || null,
      url: info.url || null,
      notes: info.notes || null,
      asset: info.asset ? { name: info.asset.name, size: info.asset.size, url: info.asset.browserUrl } : null,
      checkedVersion: current,
    },
  };
  try {
    cfg.patch(patch);
  } catch {
    /* a read-only config folder is not a reason to complain about updates */
  }
}

/**
 * The body the release description should carry, so `majin update` can verify
 * what it downloaded without a second source of truth.
 */
export function manifestLine({ sha256, bytes, version }) {
  return `sha256 ${sha256} · ${bytes} bytes · MAJIN ${version}`;
}

export function parseManifestLine(text) {
  const sha = /sha256 ([0-9a-f]{64})/.exec(String(text || ''));
  const bytes = /(\d+) bytes/.exec(String(text || ''));
  return { sha256: sha ? sha[1] : null, bytes: bytes ? Number(bytes[1]) : null };
}

/**
 * Download the installer into a folder, next to the app rather than into it (an
 * updater that lives inside the thing it replaces cannot replace it).
 *
 * Refuses a too-small file: GitHub hands back an HTML error page with 200 for a
 * missing asset sometimes, and "your installer is 512 bytes" is not something to
 * discover at double-click time.
 */
/**
 * One-click update: fetch the signed-off installer and hand it to Windows silently.
 * The running exe never replaces itself -- Inno upgrades by AppId, config and data
 * live outside {app}, and the caller shuts the app down right after this resolves.
 */
export async function installSetup(o = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'windows_only', hint: 'one-click install needs Windows; download MAJIN-Setup.exe by hand' };
  }
  const dl = await downloadSetup(o);
  if (!dl.ok) return dl;
  const { spawn } = await import('node:child_process');
  const child = spawn(dl.file, ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART'], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
  return { ok: true, file: dl.file };
}

export async function downloadSetup(o = {}) {
  const cfg = o.cfg || load();
  const conf = cfg.get('updates') || {};
  const url = o.url || (conf.asset && conf.asset.url);
  if (!url) return { ok: false, error: `no download url yet -- run: majin update --check` };
  const dir = o.dir || path.join(process.env.USERPROFILE || process.env.HOME || '.', 'Downloads');
  const impl = o.fetchImpl || globalThis.fetch;
  const out = path.join(dir, SETUP_ASSET);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const res = await impl(url, { signal: AbortSignal.timeout(o.timeoutMs || 120000), redirect: 'follow' });
    if (!res.ok) return { ok: false, error: `download failed: ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024 * 1024) {
      return { ok: false, error: `the file is ${buf.length} bytes, which is not an installer -- refusing to save it` };
    }
    if (buf.slice(0, 2).toString('latin1') !== 'MZ') {
      return { ok: false, error: 'the downloaded file is not a Windows executable (no MZ header)' };
    }
    const tmp = out + '.part';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, out);
    return { ok: true, file: out, bytes: buf.length, sha256: await sha256Of(buf), note: o.verifyNote || null };
  } catch (err) {
    return { ok: false, error: err.name === 'TimeoutError' ? 'the download timed out' : err.message };
  }
}

async function sha256Of(buf) {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Start the background check: deferred, unref'd and once per process, so it can
 * never hold the exit or delay the port. Called from the server boot only -- a
 * CLI command that wants to print and leave checks for itself instead.
 */
export function scheduleUpdateCheck(o = {}) {
  const cfg = o.cfg || load();
  const conf = cfg.get('updates') || {};
  if (conf.check === false || process.env.MAJIN_NO_UPDATE_CHECK === '1') return null;
  const t = setTimeout(() => {
    checkForUpdate({ cfg, version: o.version, fetchImpl: o.fetchImpl, silent: true })
      .then((info) => {
        const seen = info && info.latest && o.version ? compareVersions(o.version, info.latest) < 0 : false;
        if (o.onInfo) {
          try {
            o.onInfo({ ...info, available: seen, notice: seen ? notice(info, o.version) : '' });
          } catch {
            /* a bad callback is not the update check's problem */
          }
        }
        if (seen && o.log) o.log.info('update.available', { latest: info.latest, url: info.url });
      })
      .catch(() => {});
  }, 4000);
  if (t.unref) t.unref();
  return t;
}
