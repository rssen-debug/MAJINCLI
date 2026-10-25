#!/usr/bin/env node
/**
 * MAJIN V5 — GRAND ARCHITECT CLI Entrypoint (`bin/majin-v5.mjs`)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createV5Server } from '../src/v5/server.js';
import { createDriverTools } from '../src/v5/codex-tools.js';
import { FileAndAccessController } from '../src/v5/files-access.js';
import { GRANTABLE_LANES } from '../src/v4/owner-mode.js';
import { V5_VERSION, resolveBuildSha } from '../src/v5/ops.js';
import { resolveV5DataDir } from '../scripts/v5/desktop-host.mjs';

const [command = 'serve', ...args] = process.argv.slice(2);

function readArg(flag, fallback) {
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}

async function main() {
  if (['version', '--version', '-v'].includes(command)) {
    const build = resolveBuildSha(path.resolve(import.meta.dirname, '..'));
    console.log(`majin-v5 ${V5_VERSION} (${build.shortSha}) · node ${process.versions.node}`);
    return;
  }

  if (['help', '--help', '-h'].includes(command)) {
    console.log(
      [
        `MAJIN V5 — GRAND ARCHITECT (${V5_VERSION})`,
        'Commands:',
        '  serve [--host 0.0.0.0] [--port 4555] [--data-dir <dir>] [--submit-origin <origin>] [--max-rounds <n>]',
        '                                                            Start V5 Black Box UI & HTTP Host',
        '  tools [--search <text>] [--json] [--all-lanes] [--lanes <csv>] [--data-dir <dir>]',
        '                                                            List/search the full V5 tool universe and unavailable reasons',
        '  window                                                    Open native MAJIN V5 Electron window',
        '  status [--port 4555]                                      Check running V5 host health',
        '  version                                                   Print V5 version and Git SHA',
      ].join('\n'),
    );
    return;
  }

  if (command === 'tools') {
    const dataDir = readArg('--data-dir', resolveV5DataDir());
    const accessController = new FileAndAccessController({ dataDir });
    const access = accessController.describeAccessState();
    const lanesArg = readArg('--lanes', '');
    const requestedLanes = lanesArg ? lanesArg.split(',').map((lane) => lane.trim()).filter(Boolean) : [];
    const unknownLanes = requestedLanes.filter((lane) => !GRANTABLE_LANES.includes(lane));
    if (unknownLanes.length) throw new Error(`Unknown lane(s): ${unknownLanes.join(', ')}`);
    const grantedLanes = args.includes('--all-lanes')
      ? [...GRANTABLE_LANES]
      : lanesArg
        ? requestedLanes
        : access.grantedLanes;
    const tools = await createDriverTools({
      workspace: accessController.workspaceDir,
      allowedFolders: access.grantedFolders,
      grantedLanes,
      controller: 'provider',
      browser: grantedLanes.includes('browser'),
      desktop: grantedLanes.includes('desktop') || grantedLanes.includes('computer'),
      processAccess: grantedLanes.includes('shell') || grantedLanes.includes('shelltools'),
      browserWriteOrigins: args.flatMap((value, index) => value === '--submit-origin' && args[index + 1] ? [args[index + 1]] : []),
    });
    const valueFlags = new Set(['--data-dir', '--lanes', '--search', '--limit', '--submit-origin']);
    const positionals = [];
    for (let index = 0; index < args.length; index++) {
      if (valueFlags.has(args[index])) index++;
      else if (!args[index].startsWith('--')) positionals.push(args[index]);
    }
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
