#!/usr/bin/env node
/**
 * MAJIN V5 — GRAND ARCHITECT CLI Entrypoint (`bin/majin-v5.mjs`)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createV5Server } from '../src/v5/server.js';
import { createDriverTools } from '../src/v5/codex-tools.js';
import { CodexDriver } from '../src/v5/codex-driver.js';
import { ProviderManager } from '../src/v5/providers.js';
import { FileAndAccessController } from '../src/v5/files-access.js';
import { GRANTABLE_LANES } from '../src/v4/owner-mode.js';
import { V5_VERSION, resolveBuildSha } from '../src/v5/ops.js';
import { resolveV5DataDir } from '../scripts/v5/desktop-host.mjs';

let [command = 'serve', ...args] = process.argv.slice(2);

const KNOWN_COMMANDS = new Set([
  'serve', 'start', 'tools', 'status', 'url', 'window', 'ui', 'app', 'version', '--version', '-v',
  'help', '--help', '-h', 'run', 'goal', 'ask', 'chat', 'repl', 'session', 'resume', 'grants', 'access', 'doctor', 'logs', 'history',
  'model', 'models', 'provider',
]);

// A non-technical owner should be able to write a bare instruction:
//   majin-v5 "Gör XYZ"
//   majin-v5 Gör XYZ --all-lanes
// A single unknown token still errors instead of silently becoming a goal.
if (!KNOWN_COMMANDS.has(command) && !String(command).startsWith('-')
  && (/\s/.test(String(command)) || args.some((arg) => !String(arg).startsWith('--')))) {
  args = [command, ...args];
  command = 'run';
}

function readArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

function readAllArgs(flag) {
  return args.flatMap((value, index) => value === flag && args[index + 1] ? [args[index + 1]] : []);
}

function positionalsFor(valueFlags = new Set()) {
  const out = [];
  for (let index = 0; index < args.length; index++) {
    if (valueFlags.has(args[index])) index++;
    else if (!String(args[index]).startsWith('--')) out.push(args[index]);
  }
  return out;
}

function parseLaneSelection({ fallback = [] } = {}) {
  const lanesArg = readArg('--lanes', '');
  const requested = lanesArg ? lanesArg.split(',').map((lane) => lane.trim()).filter(Boolean) : [];
  const unknown = requested.filter((lane) => !GRANTABLE_LANES.includes(lane));
  if (unknown.length) throw new Error(`Unknown lane(s): ${unknown.join(', ')}`);
  const all = args.includes('--all-lanes');
  return {
    explicit: Boolean(all || lanesArg),
    lanes: all ? [...GRANTABLE_LANES] : lanesArg ? requested : [...fallback],
  };
}

function folderArgs() {
  return readAllArgs('--folder').map((folder) => path.resolve(folder));
}

function buildLabel() {
  return String(resolveBuildSha(path.resolve(import.meta.dirname, '..'))).slice(0, 12);
}

function withWorkspaceFolderIfFiles(lanes, folders, workspaceDir) {
  // OwnerMode keeps the external-files lane inactive until a folder exists.
  // The V5 workspace is already MAJIN's own work area, so use it as the
  // minimum explicit folder when the owner grants `files` from this CLI.
  // Folders outside the workspace still require an explicit --folder.
  return lanes.includes('files') && folders.length === 0 ? [workspaceDir] : folders;
}

function submitOrigins() {
  return readAllArgs('--submit-origin');
}

function parseJsonValue(raw, label) {
  try {
    return JSON.parse(String(raw));
  } catch (error) {
    throw new Error(`${label} must be valid JSON: ${error.message}`);
  }
}

function readCriteria() {
  const file = readArg('--criteria-file', '');
  const raw = file ? fs.readFileSync(path.resolve(file), 'utf8') : readArg('--criteria', '');
  if (!raw) return undefined;
  const criteria = parseJsonValue(raw, 'criteria');
  if (!Array.isArray(criteria)) throw new Error('criteria must be a JSON array');
  return criteria;
}

function readJsonObjectArg() {
  const file = readArg('--args-file', '');
  const raw = file ? fs.readFileSync(path.resolve(file), 'utf8') : readArg('--args', '');
  if (!raw) return {};
  const value = parseJsonValue(raw, 'tool args');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('tool args must be a JSON object');
  return value;
}

function accessFor(dataDir) {
  const accessController = new FileAndAccessController({ dataDir });
  return { accessController, access: accessController.describeAccessState() };
}

function runtimeFromLanes(lanes) {
  return {
    browser: lanes.includes('browser'),
    desktop: lanes.includes('desktop') || lanes.includes('computer'),
    processAccess: lanes.includes('shell') || lanes.includes('shelltools'),
  };
}

const DEFAULT_API_KEY_ENV = Object.freeze({
  'opencode-go': 'OPENCODE_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  xai: 'XAI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ollama: '',
});

function apiKeyFromCli(providerId) {
  if (args.includes('--api-key')) {
    throw new Error('Refusing --api-key in argv (shell history/process lists leak secrets). Use --api-key-env <VAR> or --api-key-stdin.');
  }
  if (args.includes('--api-key-stdin')) {
    return fs.readFileSync(0, 'utf8').trim();
  }
  if (args.includes('--no-key')) return null;
  const envName = readArg('--api-key-env', DEFAULT_API_KEY_ENV[providerId] || 'MAJIN_PROVIDER_API_KEY');
  if (!envName) return null;
  const value = String(process.env[envName] || '').trim();
  if (!value && providerId !== 'ollama') {
    throw new Error(`Environment variable ${envName} is not set. Export it first, use --api-key-env <VAR>, --api-key-stdin, or --no-key to save only endpoint/provider settings.`);
  }
  return value || null;
}

function printProviderState(state, extra = null) {
  if (args.includes('--json')) {
    console.log(JSON.stringify(extra ? { ...extra, provider: state } : state, null, 2));
    return;
  }
  console.log(`Active model: ${state.canonicalSelection || '(none selected)'}`);
  console.log(`Saved config: ${state.savedConfig ? 'yes' : 'no'} · connection verified: ${state.connectionVerified ? 'yes' : 'no'}`);
  if (state.lastVerifiedAt) console.log(`Last verified: ${state.lastVerifiedAt}${state.lastVerifiedModelId ? ` (${state.lastVerifiedModelId})` : ''}`);
  const providers = Object.values(state.providers || {});
  if (providers.length) {
    console.log('Configured providers:');
    for (const provider of providers) {
      const models = provider.discoveredModels || [];
      console.log(`  ${provider.id} — ${provider.label || provider.id} · key: ${provider.hasKey ? (provider.maskedKey || 'saved') : 'missing'} · verified: ${provider.connectionVerified ? 'yes' : 'no'} · models: ${models.length}${models.length ? ` (${models.slice(0, 8).join(', ')}${models.length > 8 ? ', …' : ''})` : ''}`);
      if (provider.lastError) console.log(`    last error: ${provider.lastError.code || 'PROVIDER_ERROR'} — ${provider.lastError.message || ''}`);
    }
  } else {
    console.log('Configured providers: (none)');
  }
  const presets = state.presets || [];
  if (presets.length) console.log(`Available presets: ${presets.map((preset) => preset.id).join(', ')}`);
  if (extra?.discovery) {
    if (extra.discovery.ok) console.log(`Discovery: ok (${extra.discovery.models?.length || 0} models)`);
    else console.log(`Discovery: failed (${extra.discovery.error?.code || 'PROVIDER_ERROR'} — ${extra.discovery.error?.message || 'unknown error'})`);
  }
}

function printAccess(access, ownerView = null) {
  if (args.includes('--json')) {
    console.log(JSON.stringify(ownerView ? { ...access, ownerMode: ownerView } : access, null, 2));
    return;
  }
  console.log(`Owner mode: ${access.ownerModeActive ? 'active' : 'inactive'}`);
  console.log(`Granted lanes (${access.grantedLanes.length}): ${access.grantedLanes.length ? access.grantedLanes.join(', ') : '(none)'}`);
  const stored = ownerView?.granted || [];
  const storedInactive = stored.filter((lane) => !access.grantedLanes.includes(lane));
  if (storedInactive.length) {
    console.log(`Stored but inactive: ${storedInactive.join(', ')}${storedInactive.includes('files') ? ' (files needs at least one granted folder; workspace tools remain available)' : ''}`);
  }
  console.log(`Granted folders (${access.grantedFolders.length}): ${access.grantedFolders.length ? access.grantedFolders.join(', ') : '(workspace only)'}`);
  console.log(`OS administrator elevated: ${access.osAdminElevated ? 'yes' : 'no'} — separate from MAJIN owner mode.`);
}

function printGoalResult(result) {
  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const goal = result.goal || result;
  console.log(`Status: ${goal.status || 'UNKNOWN'}`);
  if (goal.goal_id) console.log(`Goal: ${goal.goal_id}`);
  if (goal.summaryText) console.log(goal.summaryText);
  if (goal.model_reply && goal.model_reply !== goal.summaryText) console.log(goal.model_reply);
  if (goal.blocker) console.log(`Blocker: ${goal.blocker}`);
  if (goal.errorCode) console.log(`Error: ${goal.errorCode}`);
  const tools = Array.isArray(goal.tool_results) ? goal.tool_results : [];
  if (tools.length) {
    console.log(`Tool results (${tools.length}):`);
    for (const row of tools) {
      console.log(`  ${row.ok ? 'ok' : 'failed'} ${row.tool || 'tool'}${row.status ? ` [${row.status}]` : ''}${row.errorCode ? ` ${row.errorCode}` : ''}${row.blocker ? ` — ${row.blocker}` : ''}`);
    }
  }
  const evidence = Array.isArray(goal.verification_evidence) ? goal.verification_evidence : [];
  console.log(`Verification evidence: ${evidence.length}`);
  if (goal.budget?.maxRounds) console.log(`Model round budget: ${goal.budget.maxRounds}`);
  if (goal.cost) console.log(`Model calls: ${goal.cost.modelCalls || 0}, input tokens: ${goal.cost.inputTokens || 0}, output tokens: ${goal.cost.outputTokens || 0}`);
}

function goalExitCode(result) {
  const status = (result.goal || result).status;
  if (status === 'COMPLETED') return 0;
  if (status === 'PARTIAL') return 2;
  return 1;
}

const NO_PROVIDER_GUIDANCE = 'No active provider model is configured for free-form V5 goals. Configure one with `majin-v5 model configure --provider opencode-go --api-key-env OPENCODE_API_KEY --discover`, inspect state with `majin-v5 doctor`, or use `majin-v5 tools call <tool>` for deterministic tool execution. Pass --allow-deterministic only for scripted GrandArchitect flows.';

function applyExplicitCliGrants(srv) {
  // Explicit lanes/folders on a local owner CLI run are a persistent owner
  // grant (the provider reads persisted access state). Without them, the
  // existing grants are used exactly as stored.
  const selection = parseLaneSelection({ fallback: srv.architect.files.describeAccessState().grantedLanes });
  const folders = folderArgs();
  if (!selection.explicit && !folders.length) return srv.architect.files.describeAccessState();
  const current = srv.architect.files.describeAccessState();
  const lanes = [...new Set([...current.grantedLanes, ...selection.lanes])];
  return srv.architect.files.enableOwnerMode({
    lanes,
    folders: withWorkspaceFolderIfFiles(
      lanes,
      [...new Set([...current.grantedFolders, ...folders])],
      srv.architect.workspaceDir,
    ),
  });
}

function requireCliProviderModel(srv, { resume = false } = {}) {
  const hasActiveModel = Boolean(srv.architect.providers.state.activeModelId);
  const needsProvider = resume ? Boolean(srv.providerAgent.getGoalState()) : true;
  if (needsProvider && !hasActiveModel && !args.includes('--allow-deterministic')) {
    throw new Error(NO_PROVIDER_GUIDANCE);
  }
  return hasActiveModel;
}

async function postGoalJson(baseUrl, endpoint, body = {}) {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error?.message || result.message || `Goal request failed with HTTP ${response.status}`);
  }
  return result;
}

function createGoalProgressPrinter(srv) {
  if (args.includes('--quiet')) return { begin() {}, flush() {}, end() {}, stop() {} };
  const printedByGoal = new Map();
  let lastGoalId = '';
  let lastStatus = '';
  let watching = false;
  const currentGoal = () => {
    try { return srv.providerAgent.getGoalState() || srv.architect.getGoalState(); }
    catch { return null; } // State can be between checkpoints while a goal is starting.
  };
  const goalKey = (goal) => String(goal?.goal_id || goal?.goalId || 'goal');
  const flush = () => {
    if (!watching) return;
    const goal = currentGoal();
    if (!goal) return;
    const key = goalKey(goal);
    const rows = Array.isArray(goal.tool_results) ? goal.tool_results : [];
    if (!printedByGoal.has(key)) printedByGoal.set(key, 0);
    if (goal.status && (key !== lastGoalId || goal.status !== lastStatus)) {
      console.error(`[majin] ${goal.status}${goal.budget?.maxRounds ? ` · budget ${goal.budget.maxRounds} model rounds` : ''}`);
    }
    let printed = printedByGoal.get(key) || 0;
    if (printed > rows.length) printed = 0;
    for (; printed < rows.length; printed++) {
      const row = rows[printed];
      console.error(`[majin] tool ${row.tool || 'unknown'} ${row.ok ? 'ok' : 'failed'}${row.status ? ` [${row.status}]` : ''}${row.errorCode ? ` ${row.errorCode}` : ''}${row.blocker ? ` — ${row.blocker}` : ''}`);
    }
    printedByGoal.set(key, printed);
    lastGoalId = key;
    lastStatus = goal.status || lastStatus;
  };
  const timer = setInterval(flush, 250);
  return {
    begin() {
      watching = true;
      const goal = currentGoal();
      // A resumed goal already contains observed tool rows. They are evidence
      // in `logs`, not new live progress, so do not replay them in the CLI.
      // Baseline the old status too: only transitions from this operation are
      // live progress, and an idle chat must not re-announce a saved goal.
      if (goal) {
        const key = goalKey(goal);
        printedByGoal.set(key, Array.isArray(goal.tool_results) ? goal.tool_results.length : 0);
        lastGoalId = key;
        lastStatus = goal.status || '';
      } else {
        lastGoalId = '';
        lastStatus = '';
      }
    },
    flush,
    end() { flush(); watching = false; },
    stop() { flush(); clearInterval(timer); },
  };
}

async function executeGoalCommand({ resume = false } = {}) {
  const dataDir = readArg('--data-dir', resolveV5DataDir());
  const valueFlags = new Set([
    '--data-dir', '--lanes', '--folder', '--submit-origin', '--max-rounds', '--criteria', '--criteria-file', '--file',
  ]);
  const goalText = positionalsFor(valueFlags).join(' ').trim();
  if (!resume && !goalText) throw new Error('Goal text is required. Example: majin-v5 run "Gör XYZ"');
  const criteria = readCriteria();
  const maxRounds = Number(readArg('--max-rounds', '')) || undefined;
  const srv = createV5Server({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    providerMaxRounds: maxRounds,
    browserWriteOrigins: submitOrigins(),
  });

  requireCliProviderModel(srv, { resume });
  applyExplicitCliGrants(srv);

  const bound = await srv.start();
  const progress = createGoalProgressPrinter(srv);
  progress.begin();
  let interrupted = false;
  const onInterrupt = async () => {
    if (interrupted) return;
    interrupted = true;
    try {
      await fetch(`${bound.url}/api/v5/goal/cancel`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    } catch { /* the persisted checkpoint remains the source of truth */ }
    try { await srv.stop(); } catch { /* process is exiting */ }
    process.exit(130);
  };
  process.once('SIGINT', onInterrupt);
  try {
    const files = readAllArgs('--file').map((file) => ({ name: path.basename(file), path: file }));
    const endpoint = resume ? '/api/v5/goal/resume' : '/api/v5/goal';
    const body = resume
      ? { goalText: goalText || undefined, criteria, maxRounds }
      : { goalText, criteria, maxRounds, files };
    const result = await postGoalJson(bound.url, endpoint, body);
    progress.flush();
    printGoalResult(result);
    process.exitCode = goalExitCode(result);
  } finally {
    progress.stop();
    process.removeListener('SIGINT', onInterrupt);
    if (!interrupted) await srv.stop();
  }
}

function printChatHelp() {
  console.log([
    'Interactive commands:',
    '  <text>                         Start a goal; while running, text steers the active goal',
    '  /steer <text>                  Steer the active goal without restarting it',
    '  /queue <text>                  Queue a goal after the active one; /queue lists queued goals',
    '  /pause                         Pause and preserve the checkpoint (Ctrl-C does the same while running)',
    '  /resume [instruction]          Resume the saved checkpoint without replaying observed work',
    '  /cancel                        Cancel the active goal and preserve its checkpoint for inspection',
    '  /new <text>                    Start a new goal instead of resuming a paused/blocked checkpoint',
    '  /status                        Show model, grants, queue and current goal state',
    '  /checkpoint                    Show the persisted checkpoint location and adaptive plan state',
    '  /logs                          Show tool results, blockers and verification evidence',
    '  /model [status|list|verify]   Inspect provider state or refresh its live catalog',
    '  /model select <model-id>      Select a model for the next goal',
    '  /tools [query]                 Search all 155 tools and show availability/reasons',
    '  /grants [show]                 Show persisted owner lanes and folders',
    '  /grants grant [all|lane,csv] [--folder <dir>]',
    '  /grants revoke [all|lane,csv] [--folder <dir>]',
    '  /attach <path>                 Attach a file to the next new goal; /files lists pending files',
    '  /criteria [<json>|clear]      Set/show acceptance criteria for the next new goal',
    '  /help                          Show this help',
    '  /exit                          Pause an active goal, save the session and exit',
  ].join('\n'));
}

async function executeChatCommand() {
  const dataDir = readArg('--data-dir', resolveV5DataDir());
  const maxRounds = Number(readArg('--max-rounds', '')) || undefined;
  const valueFlags = new Set([
    '--data-dir', '--lanes', '--folder', '--submit-origin', '--max-rounds', '--criteria', '--criteria-file', '--file',
  ]);
  const initialText = positionalsFor(valueFlags).join(' ').trim();
  const srv = createV5Server({
    host: '127.0.0.1',
    port: 0,
    dataDir,
    providerMaxRounds: maxRounds,
    browserWriteOrigins: submitOrigins(),
  });
  applyExplicitCliGrants(srv);
  const bound = await srv.start();
  const progress = createGoalProgressPrinter(srv);
  const checkpointFile = path.join(dataDir, 'provider-agent', 'current.json');

  let pendingCriteria = readCriteria();
  let pendingFiles = readAllArgs('--file').map((file) => ({ name: path.basename(file), path: file }));
  let activeOperation = null;
  let lastExitCode = 0;
  let shutdownStarted = false;
  let inputClosed = false;
  let lineChain = Promise.resolve();
  const queuedGoals = [];
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });

  const goalState = () => srv.providerAgent.getGoalState() || srv.architect.getGoalState();
  const isResumable = (goal) => ['PAUSED', 'BLOCKED'].includes(String(goal?.status || ''));
  const providerReady = () => Boolean(srv.architect.providers.state.activeModelId) || args.includes('--allow-deterministic');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'majin> ',
    terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    historySize: 200,
  });

  function updatePrompt() {
    if (activeOperation) rl.setPrompt('majin [running]> ');
    else if (isResumable(goalState())) rl.setPrompt(`majin [${String(goalState().status).toLowerCase()}]> `);
    else rl.setPrompt('majin> ');
  }

  function promptAgain() {
    if (shutdownStarted || inputClosed || rl.closed) return;
    updatePrompt();
    rl.prompt();
  }

  function printStatus() {
    const goal = goalState();
    const provider = srv.architect.providers.getPublicState();
    const access = srv.architect.files.describeAccessState();
    const payload = {
      session: srv.providerAgent.current?.conversationId || null,
      active: Boolean(activeOperation),
      queuedGoals: queuedGoals.length,
      dataDir,
      workspace: srv.architect.workspaceDir,
      checkpoint: fs.existsSync(checkpointFile) ? checkpointFile : null,
      provider: {
        activeProvider: provider.activeProvider,
        activeModelId: provider.activeModelId,
        canonicalSelection: provider.canonicalSelection,
        connectionVerified: provider.connectionVerified,
      },
      access: {
        ownerModeActive: access.ownerModeActive,
        grantedLanes: access.grantedLanes,
        grantedFolders: access.grantedFolders,
      },
      pendingFiles,
      pendingCriteria: pendingCriteria || null,
      goal: goal ? {
        goal_id: goal.goal_id || goal.goalId || null,
        objective: goal.objective || '',
        status: goal.status || 'UNKNOWN',
        blocker: goal.blocker || null,
        toolResults: Array.isArray(goal.tool_results) ? goal.tool_results.length : 0,
        verificationEvidence: Array.isArray(goal.verification_evidence) ? goal.verification_evidence.length : 0,
        resumeCount: goal.resume_count || 0,
        adaptiveMode: goal.adaptive?.mode || null,
      } : null,
    };
    if (args.includes('--json')) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(`Session: ${payload.session || '(created on first goal)'} · active: ${payload.active ? 'yes' : 'no'} · queued: ${payload.queuedGoals}`);
    console.log(`Model: ${provider.canonicalSelection || '(none selected)'} · connection verified: ${provider.connectionVerified ? 'yes' : 'no'}`);
    console.log(`Workspace: ${srv.architect.workspaceDir}`);
    console.log(`Checkpoint: ${payload.checkpoint || '(none yet)'}`);
    console.log(`Owner lanes (${access.grantedLanes.length}): ${access.grantedLanes.length ? access.grantedLanes.join(', ') : '(none)'}`);
    if (goal) {
      console.log(`Goal: ${goal.status || 'UNKNOWN'} ${goal.goal_id || goal.goalId || ''} — ${goal.objective || ''}`);
      console.log(`Tool results: ${payload.goal.toolResults} · verification evidence: ${payload.goal.verificationEvidence} · resumes: ${payload.goal.resumeCount}${payload.goal.adaptiveMode ? ` · adaptive mode: ${payload.goal.adaptiveMode}` : ''}`);
      if (goal.blocker) console.log(`Blocker: ${goal.blocker}`);
    } else {
      console.log('Goal: (none yet)');
    }
    if (pendingFiles.length) console.log(`Pending files: ${pendingFiles.map((file) => file.path).join(', ')}`);
    if (pendingCriteria) console.log(`Pending criteria for next new goal: ${JSON.stringify(pendingCriteria)}`);
  }

  function printCheckpoint() {
    const goal = goalState();
    console.log(`Checkpoint file: ${checkpointFile} (${fs.existsSync(checkpointFile) ? 'saved' : 'none'})`);
    if (!goal) {
      console.log('No saved goal checkpoint yet.');
      return;
    }
    console.log(`Goal: ${goal.status || 'UNKNOWN'} ${goal.goal_id || goal.goalId || ''}`);
    console.log(`Objective: ${goal.objective || ''}`);
    console.log(`Observed tool results: ${Array.isArray(goal.tool_results) ? goal.tool_results.length : 0} · verification evidence: ${Array.isArray(goal.verification_evidence) ? goal.verification_evidence.length : 0} · resumes: ${goal.resume_count || 0}`);
    const plan = Array.isArray(goal.adaptive?.plan) ? goal.adaptive.plan : [];
    if (plan.length) {
      console.log(`Adaptive plan (${goal.adaptive?.mode || 'direct'}, revision ${goal.adaptive?.planRevision || 0}):`);
      for (const step of plan) console.log(`  ${step.state || 'PENDING'} ${step.id} — ${step.task}${step.operationIds?.length ? ` [${step.operationIds.join(', ')}]` : ''}`);
    } else {
      console.log(`Adaptive mode: ${goal.adaptive?.mode || 'direct'} (no saved dependency plan)`);
    }
    if (isResumable(goal)) console.log('Continue with /resume [instruction], or type an instruction to resume this checkpoint. Use /new <goal> to replace it.');
  }

  function startOperation({ goalText = '', resume = false } = {}) {
    if (activeOperation) throw new Error('A goal is already running. Type text to steer it, use /queue <goal>, or /pause//cancel it first.');
    if (!resume && !String(goalText).trim()) throw new Error('Goal text is required.');
    if (resume && !goalState()) throw new Error('No saved goal checkpoint to resume.');
    if (!providerReady() && (resume ? Boolean(srv.providerAgent.getGoalState()) : true)) throw new Error(NO_PROVIDER_GUIDANCE);

    const operationCriteria = resume ? undefined : pendingCriteria;
    const operationFiles = resume ? [] : pendingFiles;
    if (!resume) {
      pendingCriteria = undefined;
      pendingFiles = [];
    }

    progress.begin();
    const operation = { resume, goalText: String(goalText || ''), promise: null, finalStatus: null };
    activeOperation = operation;
    operation.promise = (async () => {
      try {
        const endpoint = resume ? '/api/v5/goal/resume' : '/api/v5/goal';
        const body = resume
          ? { goalText: String(goalText || '').trim() || undefined, maxRounds }
          : { goalText: String(goalText), criteria: operationCriteria, maxRounds, files: operationFiles };
        const result = await postGoalJson(bound.url, endpoint, body);
        operation.finalStatus = String((result.goal || result).status || '').toUpperCase() || null;
        progress.flush();
        printGoalResult(result);
        lastExitCode = goalExitCode(result);
      } catch (error) {
        operation.finalStatus = String(goalState()?.status || 'FAILED').toUpperCase();
        lastExitCode = 1;
        console.error(`[majin] Goal request failed: ${error?.message || error}`);
      }
    })().finally(() => {
      if (activeOperation === operation) activeOperation = null;
      progress.flush();
      if (!shutdownStarted && queuedGoals.length) {
        if (['COMPLETED', 'PARTIAL'].includes(operation.finalStatus)) {
          const next = queuedGoals.shift();
          try {
            console.log(`[majin] Starting queued goal: ${next}`);
            startGoalText(next, { forceNew: true });
            return;
          } catch (error) {
            lastExitCode = 1;
            console.error(`[majin] Queued goal could not start: ${error?.message || error}`);
          }
        } else {
          // ProviderAgent has one persisted current checkpoint. Starting the
          // next goal now would replace a paused/blocked/cancelled checkpoint,
          // so keep the queue intact until the owner finishes or abandons it
          // explicitly with /new.
          console.log(`[majin] Queued goal kept: the current checkpoint is ${operation.finalStatus || 'not finished'}. Resume it to completion before queued work replaces it, or use /new to abandon that ordering.`);
        }
      }
      progress.end();
      promptAgain();
    });
    console.log(resume
      ? '[majin] Resuming saved checkpoint. Type text to steer, /pause to pause, or /cancel to cancel.'
      : '[majin] Goal started. Type text to steer it live, /pause to pause, /queue <goal> for later, or /cancel to cancel.');
    updatePrompt();
    return operation;
  }

  function startGoalText(text, { forceNew = false } = {}) {
    const goal = goalState();
    if (!forceNew && isResumable(goal)) {
      console.log('[majin] Saved checkpoint found; this instruction resumes it. Use /new <goal> to start a separate goal.');
      return startOperation({ goalText: text, resume: true });
    }
    return startOperation({ goalText: text, resume: false });
  }

  async function waitForLiveOperation() {
    // A piped or very fast second line can be processed after the goal POST
    // starts but before the in-process agent marks itself active. Wait for
    // that registration instead of letting the control route fall through to
    // the wrong/no active operation and falsely report success.
    const deadline = Date.now() + 5000;
    while (activeOperation && !srv.providerAgent.active && !srv.architect.activeGoalId && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async function steerActive(text) {
    if (!activeOperation) throw new Error('No active goal to steer. Type a goal first, or use /resume for a saved checkpoint.');
    if (!String(text || '').trim()) throw new Error('Steering instruction is required.');
    await waitForLiveOperation();
    if (!activeOperation) throw new Error('The goal finished before steering could be applied. Start a new goal or resume its checkpoint.');
    const result = await postGoalJson(bound.url, '/api/v5/goal/steer', { instruction: String(text) });
    console.log(`[majin] Steering accepted${result.goalId ? ` for ${result.goalId}` : ''}. Pending work will be replanned; observed work is preserved.`);
    return result;
  }

  async function pauseActive() {
    if (!activeOperation) throw new Error('No active goal to pause.');
    await waitForLiveOperation();
    if (!activeOperation) throw new Error('The goal finished before it could be paused.');
    const result = await postGoalJson(bound.url, '/api/v5/goal/pause', {});
    console.log('[majin] Pause requested. The checkpoint is preserved; use /resume when ready.');
    return result;
  }

  async function cancelActive() {
    if (!activeOperation) throw new Error('No active goal to cancel.');
    await waitForLiveOperation();
    if (!activeOperation) throw new Error('The goal finished before it could be cancelled.');
    const goal = goalState();
    const result = await postGoalJson(bound.url, '/api/v5/goal/cancel', { goalId: goal?.goal_id || goal?.goalId || undefined });
    console.log('[majin] Cancellation requested. Completed effects are not rolled back; inspect /logs before continuing.');
    return result;
  }

  async function shutdown({ pauseActive = false } = {}) {
    if (shutdownStarted) return;
    shutdownStarted = true;
    try {
      if (activeOperation && pauseActive) await pauseActive().catch(() => {});
      if (activeOperation) await activeOperation.promise.catch(() => {});
    } finally {
      rl.close();
      resolveDone();
    }
  }

  async function handleModel(rest) {
    const parts = rest.trim().split(/\s+/).filter(Boolean);
    const subcommand = (parts[0] || 'status').toLowerCase();
    const providerFlagIndex = parts.indexOf('--provider');
    const providerId = providerFlagIndex >= 0 ? parts[providerFlagIndex + 1] : (srv.architect.providers.state.activeProvider || 'opencode-go');
    if (subcommand === 'status' || subcommand === 'list') {
      printProviderState(srv.architect.providers.getPublicState());
      return;
    }
    if (activeOperation) throw new Error('Pause or cancel the active goal before changing or verifying the provider model.');
    if (subcommand === 'verify') {
      const discovery = await srv.architect.providers.discoverCatalog(providerId, { timeoutMs: 8000 });
      printProviderState(srv.architect.providers.getPublicState(), { discovery });
      if (!discovery.ok) lastExitCode = 1;
      return;
    }
    if (subcommand === 'select' || subcommand === 'use') {
      const modelId = parts.find((part, index) => index > 0 && part !== '--provider' && parts[index - 1] !== '--provider' && !part.startsWith('--'));
      if (!modelId) throw new Error('Model ID is required. Example: /model select deepseek-v4-pro');
      srv.architect.providers.selectModel({
        providerId,
        modelId,
        allowManualFallback: !parts.includes('--require-discovered'),
      });
      printProviderState(srv.architect.providers.getPublicState());
      return;
    }
    throw new Error('Usage: /model [status|list|verify], or /model select <model-id> [--provider <id>]');
  }

  function parseGrantTokens(tokens) {
    const folders = [];
    const laneTokens = [];
    for (let index = 0; index < tokens.length; index++) {
      if (tokens[index] === '--folder') {
        if (!tokens[index + 1]) throw new Error('--folder requires a directory path');
        folders.push(path.resolve(tokens[++index]));
      } else {
        laneTokens.push(tokens[index]);
      }
    }
    const wantsAll = laneTokens.includes('all') || laneTokens.includes('--all-lanes');
    const lanes = wantsAll ? [...GRANTABLE_LANES] : laneTokens.flatMap((token) => token.split(',')).map((lane) => lane.trim()).filter(Boolean);
    const unknown = lanes.filter((lane) => !GRANTABLE_LANES.includes(lane));
    if (unknown.length) throw new Error(`Unknown lane(s): ${unknown.join(', ')}`);
    return { lanes, folders, wantsAll };
  }

  function handleGrants(rest) {
    const tokens = rest.trim().split(/\s+/).filter(Boolean);
    const subcommand = (tokens[0] || 'show').toLowerCase();
    const files = srv.architect.files;
    if (subcommand === 'show') {
      printAccess(files.describeAccessState(), files.ownerMode.view());
      return;
    }
    if (!['grant', 'revoke'].includes(subcommand)) throw new Error('Usage: /grants [show], /grants grant [all|lane,csv] [--folder <dir>], or /grants revoke [all|lane,csv] [--folder <dir>]');
    if (activeOperation) throw new Error('Pause or cancel the active goal before changing grants; the saved checkpoint can then resume under the new grants.');
    const { lanes, folders, wantsAll } = parseGrantTokens(tokens.slice(1));
    if (subcommand === 'grant') {
      const current = files.describeAccessState();
      const lanesToGrant = lanes.length ? [...new Set([...current.grantedLanes, ...lanes])] : [...GRANTABLE_LANES];
      const updated = files.enableOwnerMode({
        lanes: lanesToGrant,
        folders: withWorkspaceFolderIfFiles(lanesToGrant, [...new Set([...current.grantedFolders, ...folders])], srv.architect.workspaceDir),
      });
      printAccess(updated, files.ownerMode.view());
      return;
    }
    let updated;
    if (wantsAll || (!lanes.length && !folders.length)) {
      updated = files.revokePermissions({});
    } else {
      updated = files.revokePermissions({ lanes: lanes.length ? lanes : null, folder: folders[0] || null });
      for (const folder of folders.slice(1)) updated = files.revokePermissions({ folder });
    }
    printAccess(updated, files.ownerMode.view());
  }

  async function handleTools(rest) {
    const access = srv.architect.files.describeAccessState();
    const tools = await createDriverTools({
      workspace: srv.architect.workspaceDir,
      allowedFolders: access.grantedFolders,
      grantedLanes: access.grantedLanes,
      controller: 'provider',
      ...runtimeFromLanes(access.grantedLanes),
      browserWriteOrigins: submitOrigins(),
    });
    const query = rest.trim();
    if (!query) {
      const status = (await tools.get('driver_status').run({})).result;
      console.log(`Tool parity: ${status.toolParity.available}/${status.toolParity.universe} (${status.toolParity.coveragePercent}%) · driver tools: ${tools.size}`);
      console.log('Use /tools <query> to inspect matching available tools and concrete unavailable reasons.');
      return;
    }
    const found = (await tools.get('tools_search').run({ query, limit: 20, includeUnavailable: true })).result;
    console.log(`Tools matching "${query}": ${found.available}/${found.total} available (${found.coveragePercent}%)`);
    for (const entry of found.matches) {
      console.log(entry.available
        ? `  available   ${entry.name} (${entry.sourceName}, lane: ${entry.lane})`
        : `  unavailable ${entry.sourceName} (lane: ${entry.lane}) — ${entry.reason}`);
    }
  }

  async function handleLine(rawLine) {
    const line = String(rawLine || '').trim();
    if (!line) return;
    if (!line.startsWith('/')) {
      if (activeOperation) await steerActive(line);
      else startGoalText(line);
      return;
    }

    const match = line.match(/^\/(\S+)\s*([\s\S]*)$/);
    const name = (match?.[1] || '').toLowerCase();
    const rest = match?.[2] || '';
    switch (name) {
      case 'help':
        printChatHelp();
        return;
      case 'status':
      case 'state':
        printStatus();
        return;
      case 'checkpoint':
        printCheckpoint();
        return;
      case 'logs':
      case 'history': {
        const goal = goalState();
        if (!goal) console.log('No saved V5 goal yet. Type a goal to start one.');
        else printGoalResult({ goal });
        return;
      }
      case 'steer':
        await steerActive(rest);
        return;
      case 'pause':
        await pauseActive();
        return;
      case 'cancel':
      case 'stop':
        await cancelActive();
        return;
      case 'resume':
        if (activeOperation) throw new Error('A goal is already running. Type text to steer it, or pause/cancel it first.');
        startOperation({ goalText: rest, resume: true });
        return;
      case 'new':
        if (!rest.trim()) throw new Error('Usage: /new <goal>');
        startGoalText(rest, { forceNew: true });
        return;
      case 'queue':
        if (!rest.trim()) {
          console.log(queuedGoals.length ? `Queued goals (${queuedGoals.length}):\n${queuedGoals.map((goal, index) => `  ${index + 1}. ${goal}`).join('\n')}` : 'No queued goals.');
        } else if (activeOperation) {
          queuedGoals.push(rest.trim());
          console.log(`[majin] Queued after the active goal (${queuedGoals.length} queued).`);
        } else {
          startGoalText(rest);
        }
        return;
      case 'model':
        await handleModel(rest);
        return;
      case 'grants':
      case 'access':
        handleGrants(rest);
        return;
      case 'tools':
        await handleTools(rest);
        return;
      case 'attach': {
        const file = rest.trim();
        if (!file) throw new Error('Usage: /attach <path>');
        const resolved = path.resolve(file);
        if (!fs.existsSync(resolved)) throw new Error(`Attached file does not exist: ${resolved}`);
        pendingFiles.push({ name: path.basename(resolved), path: resolved });
        console.log(`[majin] Attached to next new goal: ${resolved}`);
        return;
      }
      case 'files':
        console.log(pendingFiles.length ? pendingFiles.map((file) => file.path).join('\n') : 'No pending files. Use /attach <path> before the next new goal.');
        return;
      case 'detach':
        pendingFiles = [];
        console.log('[majin] Pending files cleared.');
        return;
      case 'criteria':
        if (!rest.trim()) {
          const saved = goalState()?.criteria;
          console.log(`Pending criteria: ${pendingCriteria ? JSON.stringify(pendingCriteria) : '(none)'}`);
          console.log(`Saved goal criteria: ${saved ? JSON.stringify(saved) : '(none)'}`);
        } else if (rest.trim().toLowerCase() === 'clear') {
          pendingCriteria = undefined;
          console.log('[majin] Pending criteria cleared.');
        } else {
          const parsed = parseJsonValue(rest, 'criteria');
          if (!Array.isArray(parsed)) throw new Error('criteria must be a JSON array');
          pendingCriteria = parsed;
          console.log('[majin] Acceptance criteria will apply to the next new goal. Saved checkpoints keep their original criteria.');
        }
        return;
      case 'exit':
      case 'quit':
        await shutdown({ pauseActive: true });
        return;
      default:
        throw new Error(`Unknown interactive command: /${name}. Use /help.`);
    }
  }

  const onSigterm = () => { void shutdown({ pauseActive: true }); };
  process.once('SIGTERM', onSigterm);

  rl.on('line', (line) => {
    lineChain = lineChain.then(async () => {
      if (shutdownStarted) return;
      try { await handleLine(line); }
      catch (error) { console.error(`[majin] ${error?.message || error}`); }
      promptAgain();
    });
  });
  rl.on('SIGINT', async () => {
    if (!activeOperation) {
      await shutdown();
      return;
    }
    console.log('\n[majin] Interrupt received; pausing at the saved checkpoint. Use /resume to continue or /cancel after it stops to abandon the run.');
    await pauseActive().catch((error) => console.error(`[majin] ${error?.message || error}`));
    promptAgain();
  });
  rl.on('close', () => {
    if (inputClosed) return;
    inputClosed = true;
    lineChain.catch(() => {}).then(() => shutdown({ pauseActive: false }));
  });

  try {
    const provider = srv.architect.providers.getPublicState();
    const savedGoal = goalState();
    console.log(`MAJIN V5 interactive session (${V5_VERSION})`);
    console.log(`Model: ${provider.canonicalSelection || '(none selected)'} · workspace: ${srv.architect.workspaceDir}`);
    if (!providerReady()) console.log(NO_PROVIDER_GUIDANCE);
    if (savedGoal) {
      console.log(`Saved goal: ${savedGoal.status || 'UNKNOWN'} — ${savedGoal.objective || ''}`);
      if (isResumable(savedGoal)) console.log('This checkpoint is resumable. Type an instruction or /resume to continue it; /new <goal> starts separate work.');
    }
    console.log('Type a goal, or /help for interactive commands. While a goal runs, plain text steers it live.');
    updatePrompt();
    rl.prompt();
    if (args.includes('--resume')) startOperation({ goalText: initialText, resume: true });
    else if (initialText) startGoalText(initialText);
    await done;
    await lineChain.catch(() => {});
    if (activeOperation) await activeOperation.promise.catch(() => {});
    process.exitCode = lastExitCode;
  } finally {
    process.removeListener('SIGTERM', onSigterm);
    progress.stop();
    await srv.stop();
  }
}

async function main() {
  if (['version', '--version', '-v'].includes(command)) {
    console.log(`majin-v5 ${V5_VERSION} (${buildLabel()}) · node ${process.versions.node}`);
    return;
  }

  if (['help', '--help', '-h'].includes(command)) {
    console.log(
      [
        `MAJIN V5 — GRAND ARCHITECT (${V5_VERSION})`,
        'Usage:',
        '  majin-v5 "Gör XYZ"                                        Run a goal (bare natural-language form)',
        '  majin-v5 run "Gör XYZ" [options]                          Run a goal with the adaptive V5 agent',
        'Commands:',
        '  run <goal...> [--criteria <json>|--criteria-file <file>] [--file <path>] [--max-rounds <n>]',
        '                [--all-lanes|--lanes <csv>] [--folder <dir>] [--submit-origin <origin>] [--allow-deterministic] [--quiet] [--json]',
        '                                                            Execute a goal; explicit lanes/folders are saved as owner grants',
        '  chat [first goal...] [--resume] [--criteria <json>] [--file <path>] [--max-rounds <n>]',
        '                [--all-lanes|--lanes <csv>] [--folder <dir>] [--submit-origin <origin>] [--quiet]',
        '                                                            Interactive persistent session: live steer, pause, cancel, queue, resume and checkpoints',
        '  resume [instruction...] [--criteria <json>] [--max-rounds <n>] [--json]',
        '                                                            Resume the saved goal/checkpoint without replaying completed work',
        '  grants [show] [--json]                                    Show persisted owner lanes and folders',
        '  grants grant [--all-lanes|--lanes <csv>] [--folder <dir>] [--json]',
        '                                                            Persist owner lanes/folders (default: all user-level lanes)',
        '  grants revoke [--lanes <csv>] [--folder <dir>] [--json]   Revoke selected lanes/folders, or all grants',
        '  model [status] [--json]                                   Show secret-safe provider/model state',
        '  model configure [--provider <id>] [--base-url <url>] [--kind openai|anthropic] [--label <name>]',
        '                  [--api-key-env <VAR>|--api-key-stdin|--no-key] [--discover] [--model <id>] [--json]',
        '                                                            Save provider config; raw --api-key in argv is refused',
        '  model list [--provider <id>] [--refresh] [--json]         List presets/configured providers and discovered models',
        '  model select <model-id> [--provider <id>] [--require-discovered] [--json]',
        '                                                            Select the active model (explicit CLI IDs may be manual fallbacks)',
        '  model verify [--provider <id>] [--json]                   Refresh the live provider catalog and verification state',
        '  tools [--search <text>] [--json] [--all-lanes] [--lanes <csv>] [--data-dir <dir>]',
        '                                                            List/search the full V5 tool universe and unavailable reasons',
        '  tools call <tool_name> [--args <json>|--args-file <file>] [--operation-id <id>] [--timeout-ms <n>] [--all-lanes|--lanes <csv>] [--json]',
        '                                                            Call one deterministic tool through the isolated V5 driver',
        '  doctor [--json] [--all-lanes] [--lanes <csv>]             Diagnose data dir, grants, provider and tool parity',
        '  logs [--json]                                             Show the current/last goal, tool results and blockers',
        '  serve [--host 0.0.0.0] [--port 4555] [--data-dir <dir>] [--submit-origin <origin>] [--max-rounds <n>]',
        '                                                            Start V5 Black Box UI & HTTP Host',
        '  window                                                    Open native MAJIN V5 Electron window',
        '  status [--port 4555]                                      Check running V5 host health',
        '  version                                                   Print V5 version and Git SHA',
      ].join('\n'),
    );
    return;
  }

  if (['run', 'goal', 'ask'].includes(command)) {
    await executeGoalCommand({ resume: false });
    return;
  }

  if (['chat', 'repl', 'session'].includes(command)) {
    await executeChatCommand();
    return;
  }

  if (command === 'resume') {
    await executeGoalCommand({ resume: true });
    return;
  }

  if (command === 'grants' || command === 'access') {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const { accessController, access } = accessFor(dataDir);
    const subcommand = positionalsFor(new Set(['--data-dir', '--lanes', '--folder']))[0] || 'show';
    if (subcommand === 'show') {
      printAccess(access, accessController.ownerMode.view());
      return;
    }
    if (subcommand === 'grant') {
      const selection = parseLaneSelection({ fallback: [...GRANTABLE_LANES] });
      const folders = withWorkspaceFolderIfFiles(
        selection.lanes,
        [...new Set([...access.grantedFolders, ...folderArgs()])],
        accessController.workspaceDir,
      );
      const updated = accessController.enableOwnerMode({
        lanes: selection.lanes,
        folders,
      });
      printAccess(updated, accessController.ownerMode.view());
      return;
    }
    if (subcommand === 'revoke') {
      const selection = parseLaneSelection({ fallback: [] });
      const folders = folderArgs();
      let updated = accessController.revokePermissions({
        lanes: selection.explicit ? selection.lanes : null,
        folder: folders[0] || null,
      });
      for (const folder of folders.slice(1)) updated = accessController.revokePermissions({ folder });
      printAccess(updated, accessController.ownerMode.view());
      return;
    }
    throw new Error(`Unknown grants command: ${subcommand} (use show, grant, or revoke)`);
  }

  if (['model', 'models', 'provider'].includes(command)) {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const valueFlags = new Set([
      '--data-dir', '--provider', '--base-url', '--kind', '--label', '--api-key', '--api-key-env', '--model', '--timeout-ms',
    ]);
    const positionals = positionalsFor(valueFlags);
    const subcommand = positionals[0] || 'status';
    const providers = new ProviderManager({ dataDir });

    if (subcommand === 'status' || subcommand === 'show') {
      printProviderState(providers.getPublicState());
      return;
    }

    if (subcommand === 'list') {
      const providerId = readArg('--provider', providers.state.activeProvider || 'opencode-go');
      let discovery = null;
      if (args.includes('--refresh')) {
        discovery = await providers.discoverCatalog(providerId, { timeoutMs: Number(readArg('--timeout-ms', '8000')) || 8000 });
        if (!discovery.ok) {
          printProviderState(providers.getPublicState(), { discovery });
          process.exitCode = 1;
          return;
        }
      }
      printProviderState(providers.getPublicState(), discovery ? { discovery } : null);
      return;
    }

    if (subcommand === 'verify') {
      const providerId = readArg('--provider', providers.state.activeProvider || 'opencode-go');
      const discovery = await providers.discoverCatalog(providerId, { timeoutMs: Number(readArg('--timeout-ms', '8000')) || 8000 });
      printProviderState(providers.getPublicState(), { discovery });
      if (!discovery.ok) process.exitCode = 1;
      return;
    }

    if (subcommand === 'configure' || subcommand === 'connect') {
      const providerId = String(readArg('--provider', 'opencode-go')).trim().toLowerCase();
      const apiKey = apiKeyFromCli(providerId);
      const discover = args.includes('--discover') || args.includes('--refresh');
      const timeoutMs = Number(readArg('--timeout-ms', '8000')) || 8000;
      const configured = await providers.configureProvider({
        providerId,
        apiKey,
        baseUrl: readArg('--base-url', '') || null,
        kind: readArg('--kind', '') || null,
        label: readArg('--label', '') || null,
        discover,
        timeoutMs,
      });
      const discovery = discover ? configured : null;
      if (discovery && !discovery.ok) {
        printProviderState(providers.getPublicState(), { discovery });
        process.exitCode = 1;
        return;
      }
      const modelId = readArg('--model', positionals[1] || '');
      if (modelId) {
        providers.selectModel({
          providerId,
          modelId,
          allowManualFallback: !args.includes('--require-discovered'),
        });
      }
      printProviderState(providers.getPublicState(), discovery ? { discovery } : null);
      return;
    }

    if (subcommand === 'select' || subcommand === 'use') {
      const providerId = readArg('--provider', providers.state.activeProvider || 'opencode-go');
      const modelId = readArg('--model', positionals[1] || '');
      if (!modelId) throw new Error('Model ID is required. Example: majin-v5 model select deepseek-v4-pro');
      providers.selectModel({
        providerId,
        modelId,
        allowManualFallback: !args.includes('--require-discovered'),
      });
      const state = providers.getPublicState();
      printProviderState(state);
      if (!args.includes('--json') && state.manualModelFallback) {
        console.log('Note: this exact model ID was accepted as an explicit manual fallback; run `majin-v5 model verify` or a goal to prove the live connection.');
      }
      return;
    }

    throw new Error(`Unknown model command: ${subcommand} (use status, list, configure, select, or verify)`);
  }

  if (command === 'doctor') {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const { accessController, access } = accessFor(dataDir);
    const selection = parseLaneSelection({ fallback: access.grantedLanes });
    const tools = await createDriverTools({
      workspace: accessController.workspaceDir,
      allowedFolders: access.grantedFolders,
      grantedLanes: selection.lanes,
      controller: 'provider',
      ...runtimeFromLanes(selection.lanes),
      browserWriteOrigins: submitOrigins(),
    });
    const status = (await tools.get('driver_status').run({})).result;
    const provider = new ProviderManager({ dataDir }).getPublicState();
    const activeProvider = provider.providers?.[provider.activeProvider] || null;
    const writable = (target) => {
      try { fs.accessSync(target, fs.constants.W_OK); return true; } catch { return false; }
    };
    const report = {
      version: V5_VERSION,
      build: buildLabel(),
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      hostname: os.hostname(),
      dataDir,
      workspace: accessController.workspaceDir,
      checks: {
        dataDirWritable: writable(dataDir),
        workspaceWritable: writable(accessController.workspaceDir),
        providerConfigured: Boolean(provider.activeModelId && activeProvider?.hasKey),
        providerConnectionVerified: Boolean(provider.connectionVerified),
        browserAvailable: status.browserAvailable,
        interactiveWindows: status.interactiveWindows,
      },
      access,
      provider: {
        activeProvider: provider.activeProvider,
        activeModelId: provider.activeModelId,
        canonicalSelection: provider.canonicalSelection,
        savedConfig: provider.savedConfig,
        connectionVerified: provider.connectionVerified,
        activeProviderHasKey: Boolean(activeProvider?.hasKey),
      },
      selectedHostLanes: status.selectedHostLanes,
      toolParity: {
        universe: status.toolParity.universe,
        available: status.toolParity.available,
        unavailable: status.toolParity.unavailable,
        coveragePercent: status.toolParity.coveragePercent,
      },
      driverTools: tools.size,
    };
    if (args.includes('--json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`MAJIN V5 doctor — ${report.version} (${report.build})`);
      console.log(`Host: ${report.hostname} · ${report.platform}/${report.arch} · Node ${report.node}`);
      console.log(`Data dir: ${report.dataDir} (writable: ${report.checks.dataDirWritable ? 'yes' : 'no'})`);
      console.log(`Workspace: ${report.workspace} (writable: ${report.checks.workspaceWritable ? 'yes' : 'no'})`);
      console.log(`Provider: ${report.provider.canonicalSelection || 'no active model'} · configured: ${report.checks.providerConfigured ? 'yes' : 'no'} · verified: ${report.checks.providerConnectionVerified ? 'yes' : 'no'}`);
      console.log(`Owner lanes: ${access.grantedLanes.length ? access.grantedLanes.join(', ') : '(none)'}`);
      console.log(`Tool parity: ${report.toolParity.available}/${report.toolParity.universe} (${report.toolParity.coveragePercent}%) · driver tools: ${report.driverTools}`);
      console.log(`Browser available: ${report.checks.browserAvailable ? 'yes' : 'no'} · interactive Windows: ${report.checks.interactiveWindows ? 'yes' : 'no'}`);
      if (!access.grantedLanes.length) console.log('Next: run `majin-v5 grants grant --all-lanes` or add --all-lanes to a run command to enable the full owner tool surface.');
      if (!report.checks.providerConfigured) console.log('Next: run `majin-v5 model configure --provider opencode-go --api-key-env OPENCODE_API_KEY --discover`, then `majin-v5 model select <model-id>`; deterministic tools still work via `tools call`.');
    }
    return;
  }

  if (command === 'logs' || command === 'history') {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const srv = createV5Server({ dataDir, host: '127.0.0.1', port: 0, browserWriteOrigins: submitOrigins() });
    const goal = srv.providerAgent.getGoalState() || srv.architect.getGoalState();
    if (!goal) {
      if (args.includes('--json')) console.log(JSON.stringify({ goal: null }, null, 2));
      else console.log('No saved V5 goal yet. Start one with: majin-v5 run "Gör XYZ"');
      return;
    }
    printGoalResult({ goal });
    return;
  }

  if (command === 'tools') {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const { accessController, access } = accessFor(dataDir);
    const selection = parseLaneSelection({ fallback: access.grantedLanes });
    const grantedLanes = selection.lanes;
    const valueFlags = new Set([
      '--data-dir', '--lanes', '--search', '--limit', '--submit-origin', '--args', '--args-file', '--operation-id', '--timeout-ms',
    ]);
    const positionals = positionalsFor(valueFlags);

    if (positionals[0] === 'call') {
      const toolName = positionals[1];
      if (!toolName) throw new Error('Tool name is required. Example: majin-v5 tools call sys_info --json');
      const toolArgs = readJsonObjectArg();
      const operationId = readArg('--operation-id', `cli-${randomUUID()}`);
      const timeoutMs = Number(readArg('--timeout-ms', '120000')) || 120000;
      const driver = new CodexDriver({
        workspace: accessController.workspaceDir,
        stateDir: path.join(dataDir, 'cli-driver'),
        allowedFolders: access.grantedFolders,
        grantedLanes,
        controller: 'codex',
        ...runtimeFromLanes(grantedLanes),
        browserWriteOrigins: submitOrigins(),
        timeoutMs,
      });
      try {
        await driver.start();
        const catalog = new Set(driver.list().map((tool) => tool.name));
        if (!catalog.has(toolName)) {
          throw new Error(`Tool is not available in this driver: ${toolName}. Run: majin-v5 tools --search ${toolName.replaceAll('_', '.')} --data-dir ${JSON.stringify(dataDir)}`);
        }
        const result = await driver.call(toolName, { ...toolArgs, operationId });
        if (args.includes('--json')) {
          console.log(JSON.stringify({ operationId, ...result }, null, 2));
        } else {
          for (const item of result.content || []) {
            if (item.type === 'text') console.log(item.text);
            else console.log(JSON.stringify(item));
          }
          if (!(result.content || []).length && result.structuredContent) console.log(JSON.stringify(result.structuredContent, null, 2));
        }
        if (result.isError) process.exitCode = 1;
      } finally {
        await driver.close();
      }
      return;
    }

    const tools = await createDriverTools({
      workspace: accessController.workspaceDir,
      allowedFolders: access.grantedFolders,
      grantedLanes,
      controller: 'provider',
      ...runtimeFromLanes(grantedLanes),
      browserWriteOrigins: submitOrigins(),
    });
    const query = readArg('--search', positionals[0] || '');
    const limit = Math.max(1, Math.min(50, Number(readArg('--limit', query ? '20' : '50')) || 20));
    if (query) {
      const found = (await tools.get('tools_search').run({ query, limit, includeUnavailable: true })).result;
      if (args.includes('--json')) {
        console.log(JSON.stringify(found, null, 2));
      } else {
        console.log(`MAJIN V5 tools matching "${query}": ${found.available}/${found.total} available (${found.coveragePercent}%)`);
        for (const entry of found.matches) {
          console.log(entry.available
            ? `  available   ${entry.name}  (${entry.sourceName}, lane: ${entry.lane})`
            : `  unavailable ${entry.sourceName}  (lane: ${entry.lane}) — ${entry.reason}`);
        }
      }
      return;
    }
    const status = (await tools.get('driver_status').run({})).result;
    const payload = {
      workspace: status.workspace,
      grantedLanes: status.grantedLanes,
      selectedHostLanes: status.selectedHostLanes,
      toolParity: status.toolParity,
      tools: status.toolSources,
    };
    if (args.includes('--json')) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`MAJIN V5 tool parity: ${status.toolParity.available}/${status.toolParity.universe} (${status.toolParity.coveragePercent}%)`);
      console.log(`Granted lanes: ${grantedLanes.length ? grantedLanes.join(', ') : '(none)'}`);
      console.log(`Driver tools (${tools.size}):`);
      for (const tool of status.toolSources) console.log(`  ${tool.name}  <- ${tool.source}${tool.lane ? ` [${tool.lane}]` : ''}`);
      console.log(`Unavailable tools (${status.toolParity.unavailable}) with reasons:`);
      for (const entry of status.toolParity.unavailableTools) console.log(`  ${entry.sourceName} — ${entry.reason}`);
    }
    return;
  }

  if (command === 'status' || command === 'url') {
    const port = Number(readArg('--port', process.env.MAJIN_V5_PORT || '4555'));
    const origin = `http://127.0.0.1:${port}`;
    const res = await fetch(`${origin}/api/health`, {
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    const health = await res.json();
    if (!res.ok || !health.ok || !/^5\./.test(String(health.version || ''))) {
      throw new Error('The configured port is not a healthy MAJIN V5 host.');
    }
    console.log(command === 'url' ? origin : JSON.stringify(health, null, 2));
    return;
  }

  if (['window', 'ui', 'app'].includes(command)) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'majin-v5-desktop', 'MAJIN V5.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'MAJIN V5', 'MAJIN V5.exe'),
    ];
    const exe = candidates.find((p) => fs.existsSync(p));
    if (!exe) {
      throw new Error('Install MAJIN-V5-Setup.exe first, or run: majin-v5 serve');
    }
    const child = spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false });
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    child.unref();
    return;
  }

  if (command === 'serve' || command === 'start') {
    const host = readArg('--host', process.env.MAJIN_V5_HOST || '0.0.0.0');
    const port = Number(readArg('--port', process.env.MAJIN_V5_PORT || '4555'));
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const srv = createV5Server({
      host,
      port,
      dataDir,
      providerMaxRounds: Number(readArg('--max-rounds', '')) || undefined,
      browserWriteOrigins: args.flatMap((value, index) => value === '--submit-origin' && args[index + 1] ? [args[index + 1]] : []),
    });
    const bound = await srv.start();
    console.log(`MAJIN V5 (${V5_VERSION}) listening on ${bound.url}`);
    const shutdown = async () => {
      await srv.stop();
      process.exit(0);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return;
  }

  throw new Error(`Unknown V5 command: ${command}`);
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
