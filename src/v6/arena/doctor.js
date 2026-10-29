/**
 * MAJIN V6 — Arena bridge doctor.
 *
 * Every check here reads real state and, when `--probe` is given, performs a
 * real read+write round trip against the configured relay. Nothing is assumed:
 * a missing token, an ungranted repository or an unreachable endpoint produces
 * BLOCKED with the exact remediation, never a green tick.
 *
 * Statuses:
 *   PASS        executed here and succeeded
 *   FAIL        executed here and failed
 *   BLOCKED     cannot pass without an owner action outside this process
 *   NOT_TESTED  not checked (e.g. Windows ACLs on Linux)
 */
import fs from 'node:fs';
import path from 'node:path';
import { createArenaPaths, loadArenaPolicy } from './agent.js';
import { relayFromPolicy } from './relay.js';
import { loadProfiles } from '../jobs/store.js';
import { loadPortalAdapters } from '../jobs/portal.js';

export const DOCTOR_SCHEMA = 'majin.v6.arena.doctor/v1';

const STATUS_ORDER = ['FAIL', 'BLOCKED', 'NOT_TESTED', 'PASS'];

function worst(checks) {
  for (const status of STATUS_ORDER) {
    if (checks.some((check) => check.status === status)) return status;
  }
  return 'PASS';
}

function check(id, label, status, detail, fix = null) {
  return { id, label, status, detail: String(detail).slice(0, 400), ...(fix ? { fix } : {}) };
}

function readToken({ paths, env, fsImpl }) {
  const candidates = [
    { source: 'MAJIN_V6_SYNC_TOKEN', value: env.MAJIN_V6_SYNC_TOKEN || null },
    { source: paths.githubToken, value: null },
    { source: paths.syncToken, value: null },
  ];
  for (const candidate of candidates.slice(1)) {
    try {
      const raw = fsImpl.readFileSync(candidate.source, 'utf8').trim();
      if (raw) candidate.value = raw;
    } catch { /* absent */ }
  }
  return candidates.find((candidate) => candidate.value) || null;
}

function inspectSecret(file, { fsImpl, platform }) {
  let stat;
  try {
    stat = fsImpl.statSync(file);
  } catch {
    return { present: false, mode: null, modeOk: null };
  }
  if (platform === 'win32') return { present: true, mode: null, modeOk: null, size: stat.size };
  const mode = stat.mode & 0o777;
  return { present: true, mode: mode.toString(8), modeOk: (mode & 0o077) === 0, size: stat.size };
}

export async function runArenaDoctor({
  home,
  dataDir = null,
  workspace = null,
  env = process.env,
  fetchImpl = globalThis.fetch,
  probe = false,
  fsImpl = fs,
  platform = process.platform,
  nodeVersion = process.versions.node,
  clock = Date.now,
} = {}) {
  if (!home) throw Object.assign(new Error('doctor needs a v6 home'), { code: 'DOCTOR_NO_HOME' });
  const paths = { ...createArenaPaths(home), ...paths2(home) };
  const checks = [];

  // 1. Runtime.
  const major = Number(String(nodeVersion).split('.')[0]);
  checks.push(major >= 22
    ? check('node', 'Node.js >= 22', 'PASS', `node ${nodeVersion}`)
    : check('node', 'Node.js >= 22', 'FAIL', `node ${nodeVersion}`, 'install Node.js 22 LTS; the bridge does not install it'));

  // 2. V6 home.
  try {
    fsImpl.mkdirSync(home, { recursive: true, mode: 0o700 });
    const probeFile = path.join(home, `.doctor-${clock()}.tmp`);
    fsImpl.writeFileSync(probeFile, 'ok', { mode: 0o600 });
    fsImpl.rmSync(probeFile, { force: true });
    checks.push(check('v6home', 'V6 home is writable', 'PASS', home));
  } catch (error) {
    checks.push(check('v6home', 'V6 home is writable', 'FAIL', `${home}: ${error.message}`, 'choose a writable --v6-home'));
  }

  // 3. Policy and secrets.
  const loaded = loadArenaPolicy(paths.policy, { fsImpl });
  if (!loaded.ok) {
    checks.push(check('policy', 'Owner policy', loaded.error.code === 'ARENA_POLICY_MISSING' ? 'BLOCKED' : 'FAIL',
      `${loaded.error.code}: ${loaded.error.reason}`,
      'run: majin-v6 arena init   (creates policy + signing secret + bridge token)'));
  } else {
    const policy = loaded.policy;
    checks.push(check('policy', 'Owner policy', 'PASS',
      `keyId ${policy.keyId || '(none)'}; kinds ${policy.allowedKinds.join(', ')}; irreversible ${policy.allowIrreversible ? 'ALLOWED' : 'blocked'}`));

    const secret = inspectSecret(paths.secret, { fsImpl, platform });
    if (!secret.present) {
      checks.push(check('secret', 'Signing secret', 'BLOCKED', `missing: ${paths.secret}`, 'run: majin-v6 arena init'));
    } else if (secret.modeOk === false) {
      checks.push(check('secret', 'Signing secret', 'FAIL', `mode ${secret.mode} is readable by other users`,
        platform === 'win32' ? 'restrict the file ACL to your account' : `chmod 600 ${paths.secret}`));
    } else {
      checks.push(check('secret', 'Signing secret', 'PASS', secret.mode ? `mode ${secret.mode}` : 'present (Windows ACLs not inspected — NOT_TESTED)'));
    }
    if (platform === 'win32') {
      checks.push(check('secret-acl', 'Secret file ACL', 'NOT_TESTED', 'POSIX mode bits do not describe Windows ACLs; inspect with icacls'));
    }

    const token = inspectSecret(paths.token, { fsImpl, platform });
    checks.push(token.present
      ? check('bridge-token', 'Bridge token', token.modeOk === false ? 'FAIL' : 'PASS', token.mode ? `mode ${token.mode}` : 'present')
      : check('bridge-token', 'Bridge token', 'BLOCKED', `missing: ${paths.token}`, 'run: majin-v6 arena init'));

    // 4. Relay configuration and, optionally, a real read+write probe.
    const relayCfg = policy.relay;
    if (!relayCfg || !relayCfg.type) {
      checks.push(check('relay', 'Relay configured', 'BLOCKED', 'policy has no relay', 'edit arena/policy.json and set relay.type'));
    } else if (relayCfg.type === 'github') {
      const found = readToken({ paths, env, fsImpl });
      if (!found) {
        checks.push(check('relay-token', 'Relay token', 'BLOCKED',
          `no token for ${relayCfg.repo}`,
          'create a fine-grained token with Contents: Read and write on that private repo, then save it to ' + paths.githubToken));
      } else {
        checks.push(check('relay-token', 'Relay token', 'PASS', `from ${found.source}`));
        const write = await probeGithub({ repo: relayCfg.repo, root: relayCfg.path || 'arena', token: found.value, fetchImpl, probe, clock });
        checks.push(write);
      }
    } else {
      checks.push(check('relay', 'Relay configured', 'PASS', `http ${relayCfg.url}`));
      const write = await probeHttp({ policy, paths, env, fetchImpl, probe });
      checks.push(write);
    }

    // 5. Execution prerequisites: V5 data dir, profiles, submission adapter.
    if (!dataDir || !fsImpl.existsSync(dataDir)) {
      checks.push(check('data-dir', 'V5 data directory (tool execution)', 'BLOCKED',
        dataDir ? `not found: ${dataDir}` : 'not supplied',
        'pass --data-dir <existing V5 profile>; the bridge never creates one'));
    } else {
      checks.push(check('data-dir', 'V5 data directory (tool execution)', 'PASS', dataDir));
    }

    const profilesFile = policy.profilesFile;
    if (!profilesFile) {
      checks.push(check('profiles', 'Candidate profiles', 'BLOCKED', 'policy.profilesFile is empty', 'set profilesFile in arena/policy.json'));
    } else {
      const profiles = loadProfiles(profilesFile);
      checks.push(profiles.ok
        ? check('profiles', 'Candidate profiles', 'PASS', `${(profiles.candidates || []).length} candidate(s) in ${profilesFile}`)
        : check('profiles', 'Candidate profiles', 'BLOCKED', `${profiles.error?.code}: ${profiles.error?.reason}`, `create ${profilesFile}`));
    }

    const adaptersFile = policy.submission?.adaptersFile;
    if (!adaptersFile) {
      checks.push(check('submission', 'Submission adapter', 'NOT_IMPLEMENTED',
        'no adapter file: job.submit will answer SUBMISSION_ADAPTER_NOT_CONFIGURED (by design)', null));
    } else if (!policy.allowIrreversible || !policy.allowedKinds.includes('job.submit')) {
      checks.push(check('submission', 'Submission adapter', 'BLOCKED',
        'adapter file set but the policy still blocks irreversible work',
        'add job.submit to allowedKinds and set allowIrreversible: true deliberately'));
    } else {
      const loadedAdapters = loadPortalAdapters(adaptersFile, { fsImpl });
      checks.push(loadedAdapters.ok
        ? check('submission', 'Submission adapter', 'PASS', `adapters: ${(loadedAdapters.adapters?.keys ? [...loadedAdapters.adapters.keys()] : []).join(', ') || 'none'}`)
        : check('submission', 'Submission adapter', 'FAIL', `${loadedAdapters.error?.code}: ${loadedAdapters.error?.reason}`, 'fix the adapter file schema majin.v6.portal/v1'));
    }
  }

  const verdict = worst(checks);
  const fixes = checks.filter((entry) => entry.fix).map((entry) => `${entry.id}: ${entry.fix}`);
  return {
    schema: DOCTOR_SCHEMA,
    at: new Date(clock()).toISOString(),
    home,
    dataDir: dataDir || null,
    workspace: workspace || null,
    platform,
    nodeVersion,
    probed: probe === true,
    verdict,
    checks,
    fixes,
  };
}

function paths2(home) {
  // Extra token locations that are not part of the public arena path set.
  return {
    githubToken: path.join(home, 'arena', 'github-token'),
    syncToken: path.join(home, 'sync-token'),
  };
}

async function probeGithub({ repo, root, token, fetchImpl, probe, clock }) {
  const id = `probe-${clock()}`;
  try {
    const relay = relayFromPolicy({
      policy: { relay: { type: 'github', repo, path: root } },
      token, fetchImpl,
    });
    // Read-only contact first: this alone proves token + visibility + privacy.
    const verified = await relay.probe({ id, write: probe === true });
    if (!probe) {
      return check('relay-write', 'Relay read + write', 'NOT_TESTED',
        `repository is reachable as private (${verified.repo}); re-run with --probe to write a probe object`,
        'run: majin-v6 arena doctor --probe');
    }
    return check('relay-write', 'Relay read + write', 'PASS',
      `wrote ${verified.path}, read it back, removed it (repo ${verified.repo})`);
  } catch (error) {
    const code = error.code || 'ARENA_RELAY_UNKNOWN';
    const detail = `${code}: ${String(error.message || error).slice(0, 200)}`;
    if (['SYNC_AUTH_FAILED', 'ARENA_RELAY_UNAUTHORIZED', 'SYNC_TOKEN_SCOPE_DENIED', 'ARENA_RELAY_WRITE_FAILED'].includes(code)) {
      return check('relay-write', 'Relay read + write', 'BLOCKED', detail,
        `grant this token "Contents: Read and write" on ${repo} (fine-grained token → Repository access → ${repo}), save it to <v6-home>/arena/github-token, then re-run with --probe`);
    }
    if (code === 'SYNC_REPO_NOT_PRIVATE') {
      return check('relay-write', 'Relay read + write', 'FAIL', detail,
        'the relay must be a private repository; create one and point policy.relay.repo at it');
    }
    if (code === 'SYNC_REPO_NOT_ACCESSIBLE' || code === 'ARENA_ENVELOPE_MISSING') {
      return check('relay-write', 'Relay read + write', 'BLOCKED', detail,
        `the token cannot see ${repo}; add the repository to the token's repository access list`);
    }
    return check('relay-write', 'Relay read + write', 'FAIL', detail, 'check network reachability to api.github.com');
  }
}

async function probeHttp({ policy, paths, env, fetchImpl, probe }) {
  const token = env.MAJIN_V6_SYNC_TOKEN
    || (() => { try { return fs.readFileSync(paths.githubToken, 'utf8').trim(); } catch { return null; } })();
  try {
    const relay = relayFromPolicy({ policy, token, fetchImpl });
    if (!probe) {
      return check('relay-write', 'Relay read + write', 'NOT_TESTED', 'http relay configured; re-run with --probe', 'run: majin-v6 arena doctor --probe');
    }
    const result = await relay.probe({ id: `probe-${Date.now()}` });
    return check('relay-write', 'Relay read + write', 'PASS',
      `wrote and read back ${result.path}${result.cleanedUp ? ', removed it' : ''}`);
  } catch (error) {
    return check('relay-write', 'Relay read + write', 'FAIL',
      `${error.code || 'ARENA_RELAY_HTTP'}: ${String(error.message || error).slice(0, 200)}`,
      'check the relay URL, the bearer token and that the relay process is running');
  }
}

export function renderDoctor(report) {
  const lines = [];
  lines.push('MAJIN V6 — Arena bridge doctor');
  lines.push(`home:     ${report.home}`);
  lines.push(`data dir: ${report.dataDir || '(not supplied)'}`);
  lines.push(`platform: ${report.platform}  node ${report.nodeVersion}`);
  lines.push('');
  for (const entry of report.checks) {
    lines.push(`  ${entry.status.padEnd(10)} ${entry.label.padEnd(38)} ${entry.detail}`);
  }
  lines.push('');
  lines.push(`verdict: ${report.verdict}`);
  if (report.fixes.length) {
    lines.push('next actions:');
    for (const fix of report.fixes) lines.push(`  - ${fix}`);
  }
  return `${lines.join('\n')}\n`;
}
