#!/usr/bin/env node
/**
 * MAJIN V5 — GRAND ARCHITECT CLI Entrypoint (`bin/majin-v5.mjs`)
 */
import os from 'node:os';
import path from 'node:path';
import { createV5Server } from '../src/v5/server.js';
import { V5_VERSION, resolveBuildSha } from '../src/v5/ops.js';

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
        '  version                                                   Print V5 version and Git SHA',
      ].join('\n'),
    );
    return;
  }

  if (command === 'serve' || command === 'start') {
    const host = readArg('--host', process.env.MAJIN_V5_HOST || '0.0.0.0');
    const port = Number(readArg('--port', process.env.MAJIN_V5_PORT || '4555'));
    const dataDir = readArg(
      '--data-dir',
      process.env.MAJIN_V5_DATA_DIR || path.join(os.homedir(), '.majin', 'v5'),
    );
    const srv = createV5Server({
      host,
      port,
      dataDir,
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
