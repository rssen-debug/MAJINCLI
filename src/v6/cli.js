/**
 * MAJIN V6 — command line (non-graphical).
 *
 * Commands either read real state or perform the action they name. OpenCode
 * remains the interactive AI CLI; this binary provides the MCP server, the
 * worker, owner decisions and diagnostics.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { openV6, resolveV5DataDir, resolveV6Home, stopRequested, ensureLayout } from './home.js';
import { createBridge, parseBridgeOptions } from './bridge.js';
import { createToolInvoker } from './tool-invoker.js';
import { createV6Server } from './mcp.js';
import { buildHandlers } from './handlers.js';
import { Supervisor } from './supervisor.js';
import { buildReport, renderReport } from './report.js';
import { loadProfiles } from './jobs/store.js';
import { JobHunter } from './jobs/hunter.js';
import { loadGmailCredentials, GmailClient } from './gmail.js';
import { loadSyncConfig, pushTelemetry, writeLocalReport } from './sync.js';
import { collectInventory, renderInventoryMarkdown } from './inventory.js';
import { createArenaPaths, ArenaAgent, loadArenaPolicy, sanitizeResult } from './arena/agent.js';
import { createSecret, generateKeyId, signEnvelope, POLICY_SCHEMA } from './arena/envelope.js';
import { relayFromPolicy } from './arena/relay.js';
import { createBridgeServer, loadBridgeToken } from './arena/server.js';
import { runArenaDoctor, renderDoctor } from './arena/doctor.js';
import { formatActivityLine } from './activity.js';
import { loadPortalAdapters, createPortalSubmitAdapter } from './jobs/portal.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const BOOLEAN_FLAGS = new Set(['json', 'deep', 'history', 'write', 'yes', 'dry-run', 'once', 'irreversible', 'help']);

export function parseArgs(argv = []) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const withoutDashes = token.slice(2);
    const eq = withoutDashes.indexOf('=');
    if (eq >= 0) {
      flags[withoutDashes.slice(0, eq)] = withoutDashes.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!BOOLEAN_FLAGS.has(withoutDashes) && next != null && !next.startsWith('--')) {
      flags[withoutDashes] = next;
      i += 1;
    } else {
      flags[withoutDashes] = true;
    }
  }
  return { positional, flags };
}

const bool = (value) => value === true || value === 'true' || value === '1';

function usage() {
  return `MAJIN V6 — OpenCode integration (no separate UI)

  majin-v6 doctor [--json]
  majin-v6 status [--json]
  majin-v6 mcp --workspace <dir> [--data-dir <v5>] [--v6-home <v6>]
  majin-v6 worker [--max-tasks N] [--max-runtime-ms N] [--worker-id ID] [--once]
  majin-v6 engine stop|clear-stop
  majin-v6 queue add --kind KIND [--title T] [--payload JSON] [--dedupe-key K] [--priority N] [--irreversible]
  majin-v6 queue list [--state S] [--kind K] [--json]
  majin-v6 queue get ID | retry ID | cancel ID | budget [--max-tasks N] [--max-runtime-ms N]
  majin-v6 jobs discover --candidate ID --query TEXT [--limit N]
  majin-v6 jobs list [--candidate ID] [--state S]
  majin-v6 jobs evaluate --id APP_ID
  majin-v6 jobs approve --id APP_ID --ref POLICY_REFERENCE      (owner decision)
  majin-v6 jobs verify --id APP_ID                              (read-only Gmail)
  majin-v6 jobs quota --candidate ID
  majin-v6 gmail status
  majin-v6 sync status
  majin-v6 sync push [--yes] [--dry-run]
  majin-v6 arena init [--repo owner/private] [--relay github|http] [--port N] [--force]
  majin-v6 arena status [--json]
  majin-v6 arena doctor [--probe] [--json]              real readiness check (exit 1 on FAIL/BLOCKED)
  majin-v6 arena watch [--once] [--json] [--lines N]    live activity from real events
  majin-v6 arena task --kind KIND [--payload JSON] [--title T] [--ttl MS]
  majin-v6 arena poll [--once] [--max-tasks N] [--token-file PATH]
  majin-v6 arena serve [--port N]
  majin-v6 inventory [--deep] [--history] [--write] [--json]

Global: --v6-home, --workspace, --data-dir. V6 never changes OpenCode settings,
never writes owner grants and never installs anything.`;
}

async function makeContext({ home, workspace, dataDir, log }) {
  const v6 = openV6({ home });
  const profiles = loadProfiles(v6.profilesFile);
  let gmail = null;
  let gmailStatus = { state: 'NOT_CONFIGURED', reason: 'No credentials file or OAuth environment variables' };
  const creds = loadGmailCredentials({ file: v6.gmailFile });
  if (creds.ok) {
    gmail = new GmailClient({ credentials: creds.credentials, log: v6.log });
    gmailStatus = { state: 'CONFIGURED', account: creds.credentials.account ? 'owner-account' : 'unspecified', source: creds.source };
  } else {
    gmailStatus = { state: creds.error.code === 'GMAIL_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'BLOCKED', reason: creds.error.reason };
  }
  const hunter = profiles.ok ? new JobHunter({ store: v6.jobs, profiles, log: v6.log, gmail }) : null;
  const sync = loadSyncConfig({ tokenFile: v6.syncTokenFile });
  const syncStatus = sync.ok
    ? { state: 'CONFIGURED', repo: sync.repo }
    : { state: 'NOT_CONFIGURED', reason: sync.error.reason };
  void log; void workspace; void dataDir;
  return { ...v6, profiles, gmail, gmailStatus, hunter, sync, syncStatus };
}

async function reportFor(ctx) {
  return buildReport({
    queue: ctx.queue, log: ctx.log, jobs: ctx.jobs, workersDir: ctx.workersDir, home: ctx.home,
    gmailStatus: ctx.gmailStatus, syncStatus: ctx.syncStatus,
    modelLabel: process.env.MAJIN_V6_MODEL_LABEL || null,
  });
}

async function doctor(ctx, { dataDir, workspace, json }) {
  const checks = [];
  const add = (name, status, detail) => checks.push({ name, status, detail });
  add('Node.js', process.versions.node.split('.')[0] >= 22 ? 'PASS' : 'FAIL', `v${process.versions.node}`);
  add('V6 home', 'PASS', ctx.home);
  add('V6 home isolated from V5', ctx.home !== dataDir && !ctx.home.startsWith(`${dataDir}${path.sep}`) ? 'PASS' : 'FAIL', 'V6 writes only its own tree');
  add('V5 data directory', fs.existsSync(dataDir) ? 'PASS' : 'BLOCKED', fs.existsSync(dataDir) ? dataDir : 'not found; owner grants unavailable (nothing was created)');
  add('Owner grants file', fs.existsSync(path.join(dataDir, 'owner-mode.json')) ? 'PASS' : 'BLOCKED', 'read-only input');
  add('OpenCode workspace', fs.existsSync(workspace) ? 'PASS' : 'FAIL', workspace);
  add('Candidate profiles', ctx.profiles.ok ? 'PASS' : 'BLOCKED', ctx.profiles.ok ? `${ctx.profiles.candidates.length} candidate(s)` : ctx.profiles.error.reason);
  const cvMissing = ctx.profiles.ok ? ctx.profiles.candidates.filter((candidate) => !fs.existsSync(candidate.cvPath)) : [];
  add('CV files', !ctx.profiles.ok ? 'NOT_TESTED' : (cvMissing.length ? 'FAIL' : 'PASS'), cvMissing.length ? `${cvMissing.length} missing` : 'owner-supplied paths');
  add('Gmail', ctx.gmailStatus.state === 'CONFIGURED' ? 'PASS' : 'BLOCKED', ctx.gmailStatus.reason || 'credentials present; live read NOT_TESTED');
  add('Private sync', ctx.syncStatus.state === 'CONFIGURED' ? 'PASS' : 'BLOCKED', ctx.syncStatus.reason || 'token present; private-repo verification NOT_TESTED');
  const opencode = findOpenCodeConfig();
  add('OpenCode installation', opencode.found ? 'PASS' : 'NOT_TESTED', opencode.detail);
  add('OpenCode config untouched', 'PASS', 'V6 never writes OpenCode settings');
  const report = await buildReport({ queue: ctx.queue, log: ctx.log, jobs: ctx.jobs, workersDir: ctx.workersDir, home: ctx.home, gmailStatus: ctx.gmailStatus, syncStatus: ctx.syncStatus });
  add('Worker', report.workers.length ? report.workers.map((worker) => `${worker.workerId}:${worker.state}`).join(', ') : 'NOT_RUNNING', 'heartbeat-derived');
  add('Windows acceptance', 'NOT_TESTED', 'this host is Linux; run the Windows launcher on the target machine');
  add('Job submission adapter', 'NOT_IMPLEMENTED', 'no authorized employer-portal adapter is configured');

  if (json) {
    process.stdout.write(`${JSON.stringify({ checks, report }, null, 2)}\n`);
  } else {
    process.stdout.write('MAJIN V6 — DOCTOR\n\n');
    for (const check of checks) process.stdout.write(`${check.status.padEnd(16)} ${check.name.padEnd(28)} ${check.detail}\n`);
  }
  return checks.some((check) => check.status === 'FAIL') ? 1 : 0;
}

function findOpenCodeConfig() {
  const candidates = [
    process.env.OPENCODE_CONFIG,
    path.join(process.env.HOME || '', '.config', 'opencode', 'opencode.json'),
    path.join(process.env.HOME || '', '.config', 'opencode', 'config.json'),
    path.join(process.env.APPDATA || '', 'opencode', 'opencode.json'),
  ].filter(Boolean);
  const found = candidates.find((file) => { try { return fs.statSync(file).isFile(); } catch { return false; } });
  return found
    ? { found: true, detail: `config present at ${found} (read-only; not modified)` }
    : { found: false, detail: 'OpenCode config not found on this host; install/verify it on the Windows target' };
}

async function runWorker(ctx, { flags }) {
  const maxTasks = Number(flags['max-tasks'] ?? 25);
  const maxRuntimeMs = Number(flags['max-runtime-ms'] ?? 15 * 60 * 1000);
  const once = bool(flags.once);
  const workerId = String(flags['worker-id'] || `w-${process.pid}`);
  if (stopRequested(ctx.home)) {
    fs.rmSync(ctx.stopFile, { force: true });
    ctx.log.append('engine.started', { workerId, note: 'Previous STOP marker cleared by an explicit worker start' });
  }
  const workspace = path.resolve(flags.workspace || process.cwd());
  const dataDir = resolveV5DataDir(process.env, flags['data-dir'] || null);
  let bridge = null;
  try {
    bridge = createBridge({
      workspace, dataDir, v6Home: ctx.home, log: ctx.log,
      driverStateDir: path.join(ctx.home, 'drivers', `worker-${workerId}`),
    });
    await bridge.start();
  } catch (error) {
    bridge = null;
    ctx.log.append('permission.blocked', { workerId, code: error.code || 'TOOL_BRIDGE_UNAVAILABLE', reason: String(error.message || error).slice(0, 300) });
  }
  const invoker = bridge
    ? createToolInvoker({ callToolFn: (name, args) => bridge.callTool(name, args), log: ctx.log })
    : null;
  let submission = { adapter: null, status: { state: 'NOT_CONFIGURED' } };
  let hunter = ctx.hunter;
  const loadedPolicy = loadArenaPolicy(createArenaPaths(ctx.home).policy);
  if (loadedPolicy.ok) {
    hunter = hunterForPolicy(ctx, loadedPolicy.policy) || hunter;
    // A broken adapter file must never cost the worker its other handlers.
    try {
      submission = loadArenaSubmission(ctx, loadedPolicy.policy, hunter);
    } catch (error) {
      submission = { adapter: null, status: { state: 'BLOCKED', reason: error.code || String(error.message || error) } };
      ctx.log.append('permission.blocked', { workerId, code: error.code || 'ARENA_SUBMISSION_UNAVAILABLE', reason: String(error.message || error).slice(0, 300) });
    }
  }
  const handlers = buildHandlers({ hunter, submitAdapter: submission.adapter });
  const supervisor = new Supervisor({
    queue: ctx.queue, log: ctx.log, handlers,
    workerId,
    heartbeatFile: path.join(ctx.workersDir, `${workerId}.json`),
    stopFile: ctx.stopFile,
    toolInvoker: invoker,
    limits: { maxTasks, maxRuntimeMs },
    clock: Date.now,
  });
  const onSignal = () => supervisor.requestStop('signal');
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const result = await supervisor.run({ maxTasks, maxRuntimeMs, untilEmpty: !once });
  process.removeListener('SIGINT', onSignal);
  process.removeListener('SIGTERM', onSignal);
  await bridge?.close().catch(() => {});
  process.stdout.write(`${JSON.stringify({ workerId, ...result, queue: await ctx.queue.stats() })}\n`);
  // A failed task is recorded data, not a worker crash. Exit 0 so callers can
  // read the summary; genuine errors still reach the top-level handler.
  return 0;
}

async function runMcp(opts, { log }) {
  const bridge = createBridge({ ...opts, log });
  const ctx = openV6({ home: opts.v6Home, log });
  const server = createV6Server({
    bridge, queue: ctx.queue, log, home: opts.v6Home,
    workersDir: ctx.workersDir, stopFile: ctx.stopFile,
    workspace: opts.workspace, dataDir: opts.dataDir,
  });
  console.log = (...args) => console.error(...args);
  console.info = (...args) => console.error(...args);
  const write = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch {
      write({ id: null, error: { code: -32700, message: 'Parse error' } });
      continue;
    }
    const response = await server.handle(message, { notify: write });
    if (response) write(response);
  }
  await bridge.close().catch(() => {});
  log.append('mcp.stopped', {});
  return 0;
}

async function collectAndMaybeWriteInventory({ deep, history, write, json, stdout }) {
  const inventory = await collectInventory({ repoRoot: REPO_ROOT, deep, history });
  if (write) {
    const docs = path.join(REPO_ROOT, 'docs', 'v6');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'TOOL_INVENTORY.md'), renderInventoryMarkdown(inventory));
    fs.writeFileSync(path.join(docs, 'inventory.json'), `${JSON.stringify(inventory, null, 2)}\n`);
  }
  if (json) stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  else stdout.write(`${renderInventoryMarkdown(inventory)}\n`);
  return 0;
}


/* ------------------------------- Arena ---------------------------------- */

const ARENA_DEFAULT_TOOLS = Object.freeze([
  'fs_read', 'fs_list', 'fs_write', 'fs_search', 'web_search', 'web_fetch',
  're_hash', 'documents_extract', 'jobs_search', 'driver_status',
]);

function writePrivate(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return file;
}

function readPrivate(file) {
  return fs.readFileSync(file, 'utf8').trim();
}

async function arenaInit(ctx, { flags, stdout, stderr }) {
  const paths = createArenaPaths(ctx.home);
  fs.mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const force = bool(flags.force);
  const existing = fs.existsSync(paths.policy) || fs.existsSync(paths.secret);
  if (existing && !force) {
    stderr.write(`BLOCKED: ${paths.policy} or the signing secret already exists.\nRe-run with --force only if you intend to rotate the key (old envelopes stop verifying).\n`);
    return 1;
  }
  const keyId = generateKeyId();
  const secret = createSecret();
  const bridgeToken = createSecret();
  const repo = typeof flags.repo === 'string' ? flags.repo : 'rssen-debug/majin2026';
  const relayType = flags.relay === 'http' ? 'http' : 'github';
  const policy = {
    schema: POLICY_SCHEMA,
    keyId,
    allowedKinds: ['tool', 'health.delay', 'job.discover', 'job.evaluate', 'gmail.verify'],
    allowedTools: [...ARENA_DEFAULT_TOOLS],
    allowIrreversible: false,
    clockSkewMs: 60000,
    envelopeTtlMs: 900000,
    pollIntervalMs: 15000,
    maxTasksPerPoll: 5,
    relay: relayType === 'github'
      ? { type: 'github', repo, path: 'arena', branch: null }
      : { type: 'http', url: String(flags['relay-url'] || 'http://127.0.0.1:8788') },
    server: { port: Number(flags.port) || 8787 },
    submission: { adaptersFile: null, adapterId: null },
    profilesFile: path.join(ctx.home, 'jobs', 'profiles.json'),
    candidates: [],
  };
  writePrivate(paths.secret, secret);
  writePrivate(paths.token, bridgeToken);
  writePrivate(paths.policy, policy);
  fs.mkdirSync(paths.evidence, { recursive: true, mode: 0o700 });

  stdout.write('MAJIN V6 — Arena bridge initialised\n\n');
  stdout.write(`V6 home:        ${ctx.home}\n`);
  stdout.write(`Policy:         ${paths.policy}\n`);
  stdout.write(`Signing secret: ${paths.secret}   (mode 600 — never share, never commit)\n`);
  stdout.write(`Bridge token:   ${paths.token}   (mode 600 — local client only)\n`);
  stdout.write(`keyId:          ${keyId}\n\n`);
  stdout.write('Defaults: no irreversible work. job.submit is NOT allowed until you opt in.\n');
  stdout.write('Allowed tools: ' + policy.allowedTools.join(', ') + '\n\n');
  stdout.write('Next steps:\n');
  stdout.write('  1. majin-v6 arena status                      show policy and relay\n');
  stdout.write('  2. majin-v6 arena serve                       start the loopback bridge\n');
  stdout.write('  3. majin-v6 arena task --kind health.delay --payload \'{"ms":10}\'\n');
  stdout.write('  4. majin-v6 arena poll --once                 consume relay work once\n\n');
  stdout.write('To enable real submissions later, edit allowedKinds/allowIrreversible and the\n');
  stdout.write('submission adapter file deliberately. Review docs/v6/ARENA_BRIDGE.md first.\n');
  return 0;
}

function arenaPolicyOrThrow(ctx) {
  const paths = createArenaPaths(ctx.home);
  const loaded = loadArenaPolicy(paths.policy);
  if (!loaded.ok) throw Object.assign(new Error(loaded.error.reason), { code: loaded.error.code });
  return { paths, policy: loaded.policy };
}

async function arenaStatus(ctx, { stdout, flags }) {
  const paths = createArenaPaths(ctx.home);
  const loaded = loadArenaPolicy(paths.policy);
  const secretPresent = fs.existsSync(paths.secret);
  const tokenPresent = fs.existsSync(paths.token);
  const relayHealth = loaded.ok && loaded.policy.relay ? `${loaded.policy.relay.type}` : 'not configured';
  const queueStats = await ctx.queue.stats();
  const value = {
    schema: 'majin.v6.arena.status/v1',
    home: ctx.home,
    policyState: loaded.ok ? 'CONFIGURED' : loaded.error.code,
    keyId: loaded.ok ? loaded.policy.keyId : null,
    secretPresent,
    bridgeTokenPresent: tokenPresent,
    allowedKinds: loaded.ok ? loaded.policy.allowedKinds : [],
    allowedTools: loaded.ok ? loaded.policy.allowedTools : [],
    allowIrreversible: loaded.ok ? loaded.policy.allowIrreversible : false,
    relay: loaded.ok ? loaded.policy.relay : null,
    relayTransport: relayHealth,
    serverPort: loaded.ok ? loaded.policy.server?.port : null,
    queue: queueStats,
    note: 'A configured policy is not proof that a planner can reach this host. Verify with a real poll or bridge call.',
  };
  if (bool(flags.json)) { stdout.write(`${JSON.stringify(value, null, 2)}\n`); return 0; }
  stdout.write('MAJIN V6 — ARENA BRIDGE\n\n');
  stdout.write(`Policy:          ${value.policyState}\n`);
  stdout.write(`keyId:           ${value.keyId || '(none)'}\n`);
  stdout.write(`Signing secret:  ${secretPresent ? 'present (mode 600)' : 'MISSING'}\n`);
  stdout.write(`Bridge token:    ${tokenPresent ? 'present (mode 600)' : 'MISSING'}\n`);
  stdout.write(`Relay:           ${value.relay ? `${value.relay.type} ${value.relay.repo || value.relay.url || ''}` : 'not configured'}\n`);
  stdout.write(`Allowed kinds:   ${value.allowedKinds.join(', ') || '(none)'}\n`);
  stdout.write(`Irreversible:    ${value.allowIrreversible ? 'ALLOWED' : 'blocked'}\n`);
  stdout.write(`Queue:           ${value.queue.byState?.COMPLETED || 0} completed, ${value.queue.byState?.QUEUED || 0} queued, ${value.queue.byState?.BLOCKED || 0} blocked\n`);
  stdout.write('\nNote: a policy is not proof of reachability. Run a real poll or bridge call.\n');
  return 0;
}

function arenaComponents(ctx) {
  const { paths, policy } = arenaPolicyOrThrow(ctx);
  const secret = readPrivate(paths.secret);
  return { paths, policy, secret };
}

async function arenaTask(ctx, { flags, stdout }) {
  const { paths, policy, secret } = arenaComponents(ctx);
  if (!policy.allowedKinds.includes(flags.kind)) {
    throw Object.assign(new Error(`Kind ${flags.kind} is not allowed by policy`), { code: 'ARENA_KIND_NOT_ALLOWED' });
  }
  let payload = {};
  if (typeof flags.payload === 'string') {
    try { payload = JSON.parse(flags.payload); } catch { throw Object.assign(new Error('--payload must be JSON'), { code: 'USAGE' }); }
  }
  if (flags.kind === 'tool' && !policy.allowedTools.includes(payload.tool)) {
    throw Object.assign(new Error(`Tool ${payload.tool} is not in the owner allowlist`), { code: 'ARENA_TOOL_NOT_ALLOWED' });
  }
  const irreversible = bool(flags.irreversible) || flags.kind === 'job.submit';
  if (irreversible && !policy.allowIrreversible) {
    throw Object.assign(new Error('Owner policy does not allow irreversible tasks'), { code: 'ARENA_IRREVERSIBLE_NOT_ALLOWED' });
  }
  const envelope = signEnvelope({
    secret, keyId: policy.keyId,
    ttlMs: Number(flags.ttl) || policy.envelopeTtlMs,
    task: { kind: flags.kind, title: flags.title, payload, irreversible, maxAttempts: Number(flags['max-attempts']) || 1 },
    policy: { allowTools: flags.kind === 'tool' ? [payload.tool] : [] },
  });
  const added = await ctx.queue.add({
    kind: envelope.kind, title: envelope.title, payload: envelope.payload,
    dedupeKey: `arena:${envelope.id}`,
    effectKey: envelope.irreversible ? `arena-effect:${envelope.id}` : null,
    irreversible: envelope.irreversible,
    maxAttempts: envelope.maxAttempts,
    by: 'arena-local',
  });
  ctx.log.append('arena.accepted', { workerId: 'cli', envelopeId: envelope.id, taskId: added.task.id, kind: envelope.kind });
  fs.mkdirSync(paths.outbox, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(paths.outbox, `${envelope.id}.envelope.json`), `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
  stdout.write(`${JSON.stringify({ envelopeId: envelope.id, keyId: envelope.keyId, task: added.task, deduplicated: added.deduplicated }, null, 2)}\n`);
  return 0;
}

function acquirePollerLock(paths, { clock = Date.now } = {}) {
  const lockFile = path.join(paths.root, 'poller.lock');
  if (fs.existsSync(lockFile)) {
    const raw = Number(fs.readFileSync(lockFile, 'utf8'));
    let alive = false;
    if (Number.isInteger(raw)) {
      try { process.kill(raw, 0); alive = true; } catch (error) { alive = error.code === 'EPERM'; }
    }
    if (alive) throw Object.assign(new Error(`Another Arena poller is running (pid ${raw})`), { code: 'ARENA_POLLER_BUSY' });
    fs.rmSync(lockFile, { force: true });
  }
  fs.writeFileSync(lockFile, String(process.pid), { mode: 0o600 });
  void clock;
  return () => fs.rmSync(lockFile, { force: true });
}

async function arenaPoll(ctx, { flags, stdout, workspace, dataDir }) {
  const { paths, policy } = arenaComponents(ctx);
  const release = acquirePollerLock(paths);
  const once = bool(flags.once);
  const tokenFile = flags['token-file'] || (fs.existsSync(ctx.syncTokenFile) ? ctx.syncTokenFile : null);
  const relayToken = tokenFile ? readPrivate(tokenFile) : (process.env.MAJIN_V6_SYNC_TOKEN || null);
  let bridge = null;
  let supervisor = null;
  try {
    const relay = relayFromPolicy({ policy, token: relayToken, log: ctx.log });
    if (fs.existsSync(dataDir)) {
      bridge = createBridge({
        workspace, dataDir, v6Home: ctx.home, log: ctx.log,
        driverStateDir: path.join(ctx.home, 'drivers', 'arena-poller'),
      });
      await bridge.start();
    }
    const invoker = bridge ? createToolInvoker({ callToolFn: (name, args) => bridge.callTool(name, args), log: ctx.log }) : null;
    const pollHunter = hunterForPolicy(ctx, policy) || ctx.hunter;
    let submission = { adapter: null, status: { state: 'NOT_CONFIGURED' } };
    try {
      submission = loadArenaSubmission(ctx, policy, pollHunter);
    } catch (error) {
      submission = { adapter: null, status: { state: 'BLOCKED', reason: error.code || String(error.message || error) } };
    }
    const handlers = buildHandlers({ hunter: pollHunter, submitAdapter: submission.adapter });
    const limits = {
      maxTasks: Number(flags['max-tasks']) || policy.maxTasksPerPoll,
      maxRuntimeMs: Number(flags['max-runtime-ms']) || 10 * 60 * 1000,
    };
    supervisor = new Supervisor({
      queue: ctx.queue, log: ctx.log, handlers, workerId: 'arena-poller',
      heartbeatFile: path.join(ctx.workersDir, 'arena-poller.json'),
      stopFile: ctx.stopFile, toolInvoker: invoker, limits,
    });
    const agent = new ArenaAgent({
      relay, secret: readPrivate(paths.secret), policy, queue: ctx.queue, log: ctx.log,
      ledgerFile: paths.ledger, workerId: 'arena-poller',
      runWork: ({ maxTasks }) => supervisor.run({ maxTasks, maxRuntimeMs: limits.maxRuntimeMs }),
    });
    for (;;) {
      if (stopRequested(ctx.home)) { stdout.write('STOP marker present; poller exiting.\n'); break; }
      let summary;
      try {
        summary = await agent.pollOnce();
      } catch (error) {
        ctx.log.append('arena.poll_failed', { workerId: 'arena-poller', code: error.code || 'ARENA_POLL_FAILED', reason: String(error.message || error).slice(0, 300) });
        stdout.write(`${JSON.stringify({ ok: false, code: error.code || 'ARENA_POLL_FAILED', message: error.message })}\n`);
        if (once) return 1;
        await new Promise((resolve) => setTimeout(resolve, policy.pollIntervalMs));
        continue;
      }
      stdout.write(`${JSON.stringify({ ok: true, ...summary }, null, 2)}\n`);
      if (once) return 0;
      await new Promise((resolve) => setTimeout(resolve, policy.pollIntervalMs));
    }
    return 0;
  } finally {
    await bridge?.close().catch(() => {});
    release();
  }
}

/**
 * The owner policy may point at its own profiles file (arena init does exactly
 * that). Honour it, otherwise job.* handlers would silently be missing from the
 * worker even though the policy allows them.
 */
function hunterForPolicy(ctx, policy) {
  const file = policy?.profilesFile;
  if (!file || file === ctx.profilesFile) return ctx.hunter;
  const profiles = loadProfiles(file);
  if (!profiles.ok) return ctx.hunter;
  return new JobHunter({ store: ctx.jobs, profiles, log: ctx.log, gmail: ctx.gmail });
}

function loadArenaSubmission(ctx, policy, hunter = ctx.hunter) {
  const cfg = policy.submission || {};
  if (!cfg.adaptersFile) return { adapter: null, status: { state: 'NOT_CONFIGURED' } };
  const loaded = loadPortalAdapters(cfg.adaptersFile);
  if (!loaded.ok) return { adapter: null, status: { state: 'BLOCKED', reason: loaded.error.reason } };
  if (!policy.allowIrreversible) return { adapter: null, status: { state: 'BLOCKED', reason: 'allowIrreversible is false' } };
  return {
    adapter: createPortalSubmitAdapter({
      adapters: loaded.adapters, adapterId: cfg.adapterId || null, hunter,
      evidenceDir: createArenaPaths(ctx.home).evidence, log: ctx.log,
    }),
    status: { state: 'CONFIGURED', adapters: [...loaded.adapters.keys()] },
  };
}

async function arenaDoctorCommand(ctx, { flags, stdout, workspace, dataDir }) {
  const report = await runArenaDoctor({
    home: ctx.home, dataDir, workspace, probe: bool(flags.probe),
  });
  stdout.write(bool(flags.json) ? `${JSON.stringify(report, null, 2)}\n` : renderDoctor(report));
  return report.verdict === 'PASS' || report.verdict === 'NOT_TESTED' ? 0 : 1;
}

/**
 * Live view of what MAJIN is actually doing. Reads the append-only event log and
 * the queue — the same state the status report uses. It never invents a line:
 * every row is an event that was written by a real execution.
 */
async function arenaWatch(ctx, { flags, stdout }) {
  const json = bool(flags.json);
  const once = bool(flags.once);
  const limit = Math.max(1, Math.min(500, Number(flags.lines) || 25));
  const interval = Math.max(250, Number(flags.interval) || 1000);

  const seen = new Set();
  const render = (event) => ({
    seq: event.seq,
    at: event.at,
    type: event.type,
    ...(event.taskId ? { taskId: event.taskId } : {}),
    line: formatActivityLine(event),
  });

  const drain = async ({ initial = false } = {}) => {
    const events = ctx.log.read({ limit: initial ? limit : 500 });
    const fresh = events.filter((event) => !seen.has(event.seq));
    for (const event of fresh) seen.add(event.seq);
    const rows = fresh.map(render);
    if (json) {
      if (rows.length || initial) {
        const stats = await ctx.queue.stats();
        stdout.write(`${JSON.stringify({ schema: 'majin.v6.arena.watch/v1', at: new Date().toISOString(), home: ctx.home, queue: stats, items: rows })}\n`);
      }
      return rows.length;
    }
    if (initial) {
      const stats = await ctx.queue.stats();
      stdout.write(`MAJIN V6 — Arena activity (${ctx.home})\n`);
      stdout.write(`queue: ${stats.total} task(s)${Object.keys(stats.byState || {}).length ? ` (${Object.entries(stats.byState).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}\n\n`);
    }
    for (const row of rows) stdout.write(`${row.line}\n`);
    return rows.length;
  };

  await drain({ initial: true });
  if (once) return 0;

  const stop = () => { stdout.write('\nwatch stopped.\n'); process.exit(0); };
  process.once('SIGINT', stop);
  for (;;) {
    if (stopRequested(ctx.home)) { stdout.write('STOP marker present; watch exiting.\n'); return 0; }
    await new Promise((resolve) => setTimeout(resolve, interval));
    await drain();
  }
}

async function arenaServe(ctx, { flags, stdout }) {
  const { paths, policy, secret } = arenaComponents(ctx);
  const token = loadBridgeToken(paths.token);
  const bridge = createBridgeServer({
    token, policy, secret, queue: ctx.queue, log: ctx.log, home: ctx.home,
    port: Number(flags.port) || policy.server?.port || 8787,
  });
  const address = await bridge.listen();
  ctx.log.append('mcp.started', { workerId: 'arena-bridge', note: `local bridge listening on ${address.url}` });
  stdout.write(`MAJIN V6 — local Arena bridge\n`);
  stdout.write(`Listening: ${address.url} (loopback only)\n`);
  stdout.write(`Token:     ${paths.token} (mode 600; send as 'Authorization: Bearer <token>')\n`);
  stdout.write('Endpoints: GET /healthz, GET /v1/status, POST /v1/tasks, GET /v1/tasks/:id, POST /v1/stop\n');
  stdout.write('Press Ctrl+C to stop. Nothing is exposed beyond 127.0.0.1.\n');
  const shutdown = async () => {
    await bridge.close();
    ctx.log.append('mcp.stopped', { workerId: 'arena-bridge' });
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await new Promise(() => {});
  return 0;
}

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  const { positional, flags } = parseArgs(argv);
  const home = resolveV6Home(process.env, typeof flags['v6-home'] === 'string' ? flags['v6-home'] : null);
  const workspace = path.resolve(typeof flags.workspace === 'string' ? flags.workspace : process.cwd());
  const dataDir = resolveV5DataDir(process.env, typeof flags['data-dir'] === 'string' ? flags['data-dir'] : null);
  ensureLayout(home);
  const [command, sub] = positional;
  if (!command || ['help', '--help', '-h'].includes(command)) { stdout.write(`${usage()}\n`); return 0; }

  const ctx = await makeContext({ home, workspace, dataDir });

  try {
    switch (command) {
      case 'doctor':
        return await doctor(ctx, { dataDir, workspace, json: bool(flags.json) });

      case 'status': {
        const report = await reportFor(ctx);
        if (bool(flags.json)) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        else stdout.write(`${renderReport(report)}\n`);
        return 0;
      }

      case 'mcp':
        return await runMcp(parseBridgeOptions(argv, process.env), { log: ctx.log });

      case 'worker':
        return await runWorker(ctx, { flags });

      case 'engine': {
        if (sub === 'stop') {
          fs.writeFileSync(ctx.stopFile, JSON.stringify({ requestedAt: new Date().toISOString(), by: 'cli' }), { mode: 0o600 });
          ctx.log.append('engine.stopped', { reason: 'STOP marker written by CLI' });
          stdout.write('Stop requested. Workers stop after the current task.\n');
          return 0;
        }
        if (sub === 'clear-stop') {
          fs.rmSync(ctx.stopFile, { force: true });
          stdout.write('STOP marker cleared.\n');
          return 0;
        }
        throw Object.assign(new Error('engine needs stop or clear-stop'), { code: 'USAGE' });
      }

      case 'queue': {
        if (sub === 'add') {
          if (!flags.kind) throw Object.assign(new Error('--kind is required'), { code: 'USAGE' });
          let payload = {};
          if (typeof flags.payload === 'string') {
            try { payload = JSON.parse(flags.payload); } catch { throw Object.assign(new Error('--payload must be valid JSON'), { code: 'USAGE' }); }
          }
          const added = await ctx.queue.add({
            kind: String(flags.kind), title: flags.title ? String(flags.title) : undefined,
            payload, priority: Number(flags.priority) || 0,
            dedupeKey: flags['dedupe-key'] ? String(flags['dedupe-key']) : null,
            deps: flags.dep ? [].concat(flags.dep) : [],
            irreversible: bool(flags.irreversible), by: 'owner-cli',
            maxAttempts: Number(flags['max-attempts']) || undefined,
          });
          stdout.write(`${JSON.stringify(added, null, 2)}\n`);
          return 0;
        }
        if (sub === 'list') {
          const tasks = await ctx.queue.list({ state: flags.state || null, kind: flags.kind || null, limit: Number(flags.limit) || 50 });
          if (bool(flags.json)) stdout.write(`${JSON.stringify(tasks, null, 2)}\n`);
          else {
            if (!tasks.length) stdout.write('Queue is empty.\n');
            for (const task of tasks) {
              stdout.write(`${task.id}  ${task.state.padEnd(17)} ${task.kind.padEnd(18)} attempts=${task.attempts}/${task.maxAttempts}  ${task.title}\n`);
            }
          }
          return 0;
        }
        if (sub === 'get') {
          const task = await ctx.queue.get(positional[2]);
          if (!task) { stderr.write('Task not found.\n'); return 1; }
          stdout.write(`${JSON.stringify(task, null, 2)}\n`);
          return 0;
        }
        if (sub === 'cancel') {
          const task = await ctx.queue.cancel(positional[2], { by: 'owner-cli' });
          stdout.write(`${JSON.stringify(task, null, 2)}\n`);
          return 0;
        }
        if (sub === 'retry') {
          const task = await ctx.queue.requeue(positional[2], { by: 'owner-cli' });
          stdout.write(`${JSON.stringify(task, null, 2)}\n`);
          return 0;
        }
        if (sub === 'budget') {
          if (flags['max-tasks'] || flags['max-runtime-ms'] || flags['max-tool-calls']) {
            const budget = await ctx.queue.setBudget({
              maxTasks: flags['max-tasks'], maxRuntimeMs: flags['max-runtime-ms'], maxToolCalls: flags['max-tool-calls'],
            });
            stdout.write(`${JSON.stringify(budget, null, 2)}\n`);
          } else stdout.write(`${JSON.stringify(await ctx.queue.budget(), null, 2)}\n`);
          return 0;
        }
        throw Object.assign(new Error(`Unknown queue command: ${sub}`), { code: 'USAGE' });
      }

      case 'jobs': {
        if (!ctx.hunter) {
          stderr.write(`BLOCKED: ${ctx.profiles.error.reason}\nProfiles file: ${ctx.profilesFile}\n`);
          return 1;
        }
        if (sub === 'discover') {
          if (!flags.candidate || !flags.query) throw Object.assign(new Error('--candidate and --query are required'), { code: 'USAGE' });
          const result = await ctx.hunter.discover({ candidateId: String(flags.candidate), query: String(flags.query), limit: Number(flags.limit) || 10 });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return result.ok ? 0 : 1;
        }
        if (sub === 'list') {
          const applications = await ctx.jobs.list({ candidateId: flags.candidate || null, state: flags.state || null, limit: Number(flags.limit) || 100 });
          if (bool(flags.json)) stdout.write(`${JSON.stringify(applications, null, 2)}\n`);
          else {
            if (!applications.length) stdout.write('No applications recorded.\n');
            for (const app of applications) {
              stdout.write(`${app.id}  ${app.state.padEnd(26)} ${String(app.job.company || '').slice(0, 24).padEnd(25)} ${app.job.title}\n`);
            }
          }
          return 0;
        }
        if (sub === 'evaluate') {
          const result = await ctx.hunter.evaluate({ applicationId: flags.id });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return result.ok ? 0 : 1;
        }
        if (sub === 'approve') {
          if (!flags.id || !flags.ref) throw Object.assign(new Error('--id and --ref are required'), { code: 'USAGE' });
          const result = await ctx.hunter.approve({ applicationId: String(flags.id), approvalRef: String(flags.ref) });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return result.ok ? 0 : 1;
        }
        if (sub === 'verify') {
          const result = await ctx.hunter.checkVerificationEmail({ applicationId: flags.id });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return result.ok ? 0 : 1;
        }
        if (sub === 'quota') {
          stdout.write(`${JSON.stringify(await ctx.hunter.quotaStatus(String(flags.candidate || '')), null, 2)}\n`);
          return 0;
        }
        throw Object.assign(new Error(`Unknown jobs command: ${sub}`), { code: 'USAGE' });
      }

      case 'gmail': {
        if (sub === 'status') {
          const status = ctx.gmail
            ? { state: 'CONFIGURED', account: 'owner-account', readOnly: true, liveRead: 'NOT_TESTED' }
            : { state: ctx.gmailStatus.state, reason: ctx.gmailStatus.reason };
          stdout.write(`${JSON.stringify(status, null, 2)}\n`);
          return ctx.gmail ? 0 : 1;
        }
        throw Object.assign(new Error('gmail needs status (use `jobs verify` for a read-only verification check)'), { code: 'USAGE' });
      }

      case 'sync': {
        if (sub === 'push') {
          if (!ctx.sync.ok) { stderr.write(`BLOCKED: ${ctx.sync.error.reason}\n`); return 1; }
          const report = await reportFor(ctx);
          const dryRun = bool(flags['dry-run']) || !bool(flags.yes);
          const result = await pushTelemetry({ report, repo: ctx.sync.repo, token: ctx.sync.token, dryRun, log: ctx.log });
          stdout.write(`${JSON.stringify(result, null, 2)}\n`);
          return result.ok ? 0 : 1;
        }
        if (sub === 'status') {
          stdout.write(`${JSON.stringify(ctx.syncStatus, null, 2)}\n`);
          return 0;
        }
        if (sub === 'local') {
          const report = await reportFor(ctx);
          const file = writeLocalReport({ dir: ctx.reportsDir, report });
          stdout.write(`${file}\n`);
          return 0;
        }
        throw Object.assign(new Error('sync needs status|push|local'), { code: 'USAGE' });
      }

      case 'arena': {
        if (sub === 'init') return await arenaInit(ctx, { flags, stdout, stderr });
        if (sub === 'status') return await arenaStatus(ctx, { stdout, flags });
        if (sub === 'task') return await arenaTask(ctx, { flags, stdout });
        if (sub === 'poll') return await arenaPoll(ctx, { flags, stdout, workspace, dataDir });
        if (sub === 'serve') return await arenaServe(ctx, { flags, stdout });
        if (sub === 'doctor') return await arenaDoctorCommand(ctx, { flags, stdout, workspace, dataDir });
        if (sub === 'watch') return await arenaWatch(ctx, { flags, stdout });
        throw Object.assign(new Error('arena needs init|status|task|poll|serve'), { code: 'USAGE' });
      }

      case 'inventory':
        return await collectAndMaybeWriteInventory({
          deep: bool(flags.deep), history: bool(flags.history), write: bool(flags.write),
          json: bool(flags.json), stdout,
        });

      default:
        stderr.write(`Unknown command: ${command}\n\n${usage()}\n`);
        return 2;
    }
  } catch (error) {
    stderr.write(`${error.code || 'ERROR'}: ${error.message}\n`);
    if (process.env.MAJIN_V6_DEBUG) stderr.write(`${error.stack}\n`);
    return 1;
  }
}

export { REPO_ROOT };
