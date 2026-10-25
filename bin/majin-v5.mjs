#!/usr/bin/env node
/**
 * MAJIN V5 — GRAND ARCHITECT CLI Entrypoint (`bin/majin-v5.mjs`)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  'help', '--help', '-h', 'run', 'goal', 'ask', 'resume', 'grants', 'access', 'doctor', 'logs', 'history',
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

  const hasActiveModel = Boolean(srv.architect.providers.state.activeModelId);
  const needsProvider = resume ? Boolean(srv.providerAgent.getGoalState()) : true;
  if (needsProvider && !hasActiveModel && !args.includes('--allow-deterministic')) {
    throw new Error('No active provider model is configured for free-form V5 goals. Configure/select a model in the V5 UI, run `majin-v5 doctor` to inspect provider state, or use `majin-v5 tools call <tool>` for deterministic tool execution. Pass --allow-deterministic only for scripted GrandArchitect flows.');
  }

  // Explicit lanes/folders on a local owner CLI run are a persistent owner
  // grant (the provider reads persisted access state). Without them, the
  // existing grants are used exactly as stored.
  const selection = parseLaneSelection({ fallback: srv.architect.files.describeAccessState().grantedLanes });
  const folders = folderArgs();
  if (selection.explicit || folders.length) {
    const current = srv.architect.files.describeAccessState();
    const lanes = [...new Set([...current.grantedLanes, ...selection.lanes])];
    srv.architect.files.enableOwnerMode({
      lanes,
      folders: withWorkspaceFolderIfFiles(
        lanes,
        [...new Set([...current.grantedFolders, ...folders])],
        srv.architect.workspaceDir,
      ),
    });
  }

  const bound = await srv.start();
  let printedTools = 0;
  let lastStatus = '';
  const progressTimer = args.includes('--quiet') ? null : setInterval(() => {
    let goal = null;
    try { goal = srv.providerAgent.getGoalState() || srv.architect.getGoalState(); } catch { /* state is between checkpoints */ }
    if (!goal) return;
    if (goal.status && goal.status !== lastStatus) {
      lastStatus = goal.status;
      console.error(`[majin] ${goal.status}${goal.budget?.maxRounds ? ` · budget ${goal.budget.maxRounds} model rounds` : ''}`);
    }
    const rows = Array.isArray(goal.tool_results) ? goal.tool_results : [];
    for (; printedTools < rows.length; printedTools++) {
      const row = rows[printedTools];
      console.error(`[majin] tool ${row.tool || 'unknown'} ${row.ok ? 'ok' : 'failed'}${row.status ? ` [${row.status}]` : ''}${row.errorCode ? ` ${row.errorCode}` : ''}${row.blocker ? ` — ${row.blocker}` : ''}`);
    }
  }, 250);
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
    const response = await fetch(`${bound.url}${endpoint}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok === false) {
      throw new Error(result.error?.message || result.message || `Goal request failed with HTTP ${response.status}`);
    }
    printGoalResult(result);
    process.exitCode = goalExitCode(result);
  } finally {
    if (progressTimer) clearInterval(progressTimer);
    process.removeListener('SIGINT', onInterrupt);
    if (!interrupted) await srv.stop();
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
        '  resume [instruction...] [--criteria <json>] [--max-rounds <n>] [--json]',
        '                                                            Resume the saved goal/checkpoint without replaying completed work',
        '  grants [show] [--json]                                    Show persisted owner lanes and folders',
        '  grants grant [--all-lanes|--lanes <csv>] [--folder <dir>] [--json]',
        '                                                            Persist owner lanes/folders (default: all user-level lanes)',
        '  grants revoke [--lanes <csv>] [--folder <dir>] [--json]   Revoke selected lanes/folders, or all grants',
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
      if (!report.checks.providerConfigured) console.log('Next: configure/select a provider model in the V5 UI before expecting free-form model-driven goals; deterministic tools still work via `tools call`.');
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
