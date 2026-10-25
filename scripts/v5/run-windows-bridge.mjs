#!/usr/bin/env node
/**
 * MAJIN V5 — Interactive Windows Bridge Runner.
 *
 * Runs in the owner's logged-in Windows session:
 *  1. Backs up `%LOCALAPPDATA%\MAJIN\v5` and quarantines synthetic training entries.
 *  2. Starts the local MAJIN V5 server (`http://127.0.0.1:4555`).
 *  3. Polls `origin/arena/f5f9374b-majincli:.remote/mission-queue.json` (read-only git fetch).
 *  4. Executes missions through MAJIN's own `GrandArchitect` and tools (`control.*`, `screen.capture`, visible browser).
 *  5. Uploads screenshots & results directly to the owner's private Google Drive (`MAJIN-V5-Bridge`)
 *     using AES-256-GCM encrypted pre-authorized upload URIs — never exposing private data on GitHub.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createV5Server } from '../../src/v5/server.js';
import {
  decryptBridgePayload,
  executeNotepadProofThroughMajin,
  executeVisibleBrowserJobVisitThroughMajin,
  quarantineSyntheticHistory,
  uploadToGoogleDriveResumable,
} from '../../src/v5/desktop-bridge.js';

const BRANCH = process.env.MAJIN_BRIDGE_BRANCH || 'arena/f5f9374b-majincli';
const PORT = Number(process.env.MAJIN_V5_PORT) || 4555;
const BRIDGE_KEY = String(process.env.MAJIN_BRIDGE_KEY || '').trim();

const DATA_DIR = process.env.MAJIN_V5_DATA_DIR || (
  process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'MAJIN', 'v5')
    : path.join(os.homedir(), '.majin', 'v5')
);

function log(msg) {
  console.log(`[MAJIN-BRIDGE ${new Date().toISOString()}] ${msg}`);
}

async function main() {
  if (!BRIDGE_KEY || BRIDGE_KEY.length !== 64) {
    console.error('ERROR: MAJIN_BRIDGE_KEY (64 hex chars) is required to start the bridge.');
    process.exit(1);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

  // Clean up any leftover inline trainer script from earlier
  for (const legacyFile of ['live-windows-trainer.mjs', 'DEBUGGER.md']) {
    const p = path.resolve(process.cwd(), legacyFile);
    if (fs.existsSync(p)) {
      try { fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }

  // 1. Backup & quarantine synthetic training records before starting
  const cleanReport = quarantineSyntheticHistory(DATA_DIR);
  log(`Backup created at: ${cleanReport.backupDir}`);
  log(`Quarantined synthetic records: ${cleanReport.quarantinedCount}${cleanReport.quarantineFile ? ` -> ${cleanReport.quarantineFile}` : ''}`);

  // 2. Start local MAJIN V5 server in the logged-in Windows session
  const server = createV5Server({
    dataDir: DATA_DIR,
    host: '127.0.0.1',
    port: PORT,
  });
  const { url } = await server.start();
  const architect = server.architect;

  architect.files.enableOwnerMode({
    lanes: ['files', 'browser', 'web', 'jobs'],
    folders: [DATA_DIR, architect.workspaceDir],
  });

  log(`Local MAJIN V5 running at ${url} (interactive session on ${os.hostname()})`);
  log(`Listening for missions on branch ${BRANCH} (Press Ctrl+C at any time to stop immediately)...`);

  const completedFile = path.join(DATA_DIR, 'bridge-completed-missions.json');
  const loadCompleted = () => {
    if (!fs.existsSync(completedFile)) return {};
    try { return JSON.parse(fs.readFileSync(completedFile, 'utf8')); } catch { return {}; }
  };
  const markCompleted = (missionId, info) => {
    const cur = loadCompleted();
    cur[missionId] = info;
    fs.writeFileSync(completedFile, `${JSON.stringify(cur, null, 2)}\n`, { mode: 0o600 });
  };

  let busy = false;
  const pollOnce = async () => {
    if (busy) return;
    busy = true;
    try {
      execFileSync('git', ['fetch', 'origin', BRANCH], { stdio: 'ignore', timeout: 20000 });
      const rawQueue = execFileSync(
        'git',
        ['show', `origin/${BRANCH}:.remote/mission-queue.json`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 },
      );
      const queue = JSON.parse(rawQueue);
      const missions = Array.isArray(queue?.missions) ? queue.missions : [];
      const completed = loadCompleted();

      for (const mission of missions) {
        if (!mission?.missionId || completed[mission.missionId]) continue;

        log(`==> Received mission [${mission.missionId}] (${mission.kind}): ${mission.description || ''}`);
        const uploadTargets = decryptBridgePayload(mission.encryptedUpload, BRIDGE_KEY);

        let outcome = null;
        let screenshotPath = null;

        try {
          if (mission.kind === 'notepad_proof') {
            outcome = await executeNotepadProofThroughMajin({
              architect,
              missionId: mission.missionId,
            });
            screenshotPath = outcome.screenshot?.path;
          } else if (mission.kind === 'browser_job_visit') {
            outcome = await executeVisibleBrowserJobVisitThroughMajin({
              architect,
              missionId: mission.missionId,
              url: mission.url,
              awardXp: Boolean(mission.awardXp),
            });
            screenshotPath = outcome.screenshotPath;
          } else {
            throw new Error(`Unsupported mission kind: ${mission.kind}`);
          }

          outcome.quarantineReport = cleanReport;
          outcome.ok = true;
        } catch (execErr) {
          outcome = {
            ok: false,
            missionId: mission.missionId,
            completedAt: new Date().toISOString(),
            hostname: os.hostname(),
            error: String(execErr?.message || execErr),
            quarantineReport: cleanReport,
          };
        }

        // Upload screenshot PNG to private Google Drive if available
        if (screenshotPath && fs.existsSync(screenshotPath) && uploadTargets.screenshotUploadUri) {
          const pngBytes = fs.readFileSync(screenshotPath);
          const upPng = await uploadToGoogleDriveResumable(
            uploadTargets.screenshotUploadUri,
            pngBytes,
            'image/png',
          );
          outcome.screenshotUploadedToDrive = upPng.ok;
          log(`Uploaded screenshot (${pngBytes.length} bytes) to private Google Drive.`);
        }

        // Upload result JSON to private Google Drive
        if (uploadTargets.resultUploadUri) {
          const jsonBytes = Buffer.from(`${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
          const upJson = await uploadToGoogleDriveResumable(
            uploadTargets.resultUploadUri,
            jsonBytes,
            'application/json',
          );
          outcome.resultUploadedToDrive = upJson.ok;
          log(`Uploaded mission result JSON (${jsonBytes.length} bytes) to private Google Drive.`);
        }

        markCompleted(mission.missionId, {
          completedAt: new Date().toISOString(),
          ok: outcome.ok,
          goalStatus: outcome.goalStatus || null,
        });
        log(`==> Mission [${mission.missionId}] finished (ok=${outcome.ok}, goalStatus=${outcome.goalStatus || 'N/A'}, xpAwarded=${outcome.xpAwarded ?? 0}).`);
      }
    } catch {
      // Queue file may not exist yet or network momentarily busy
    } finally {
      busy = false;
    }
  };

  await pollOnce();
  const timer = setInterval(pollOnce, 4000);

  const shutdown = async () => {
    clearInterval(timer);
    log('Stopping local MAJIN V5 bridge...');
    await server.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal bridge error:', err);
  process.exit(1);
});
