#!/usr/bin/env node
/**
 * MAJIN V5 — GRAND ARCHITECT CLI Entrypoint (`bin/majin-v5.mjs`)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createV5Server } from '../src/v5/server.js';
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
        '  serve [--host 0.0.0.0] [--port 4555] [--data-dir <dir>]   Start V5 Black Box UI & HTTP Host',
        '  window                                                    Open native MAJIN V5 Electron window',
        '  status [--port 4555]                                      Check running V5 host health',
        '  version                                                   Print V5 version and Git SHA',
      ].join('\n'),
    );
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
      browserWriteOrigins: args.flatMap((value, index) => value === '--submit-origin' ? [args[index + 1]] : []),
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
