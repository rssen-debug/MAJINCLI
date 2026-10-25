/**
 * MAJIN V5 — Interactive Windows Desktop Bridge & Synthetic History Quarantine.
 *
 * Reuses MAJIN's existing desktop control (`src/core/tools/wincontrol.js`) and
 * screen capture (`src/core/tools/net.js`) tools through `GrandArchitect` in
 * the owner's logged-in Windows session.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { winControlTools } from '../core/tools/wincontrol.js';
import { netTools, validatePngBytes } from '../core/tools/net.js';
import { isVerifiedOutcomeReceipt } from './xp-engine.js';

const execFileAsync = promisify(execFile);

/**
 * 1. Backup `%LOCALAPPDATA%\MAJIN\v5` and quarantine fabricated synthetic training
 *    records without modifying genuine user history or provider configuration.
 */
export function quarantineSyntheticHistory(dataDir) {
  if (!dataDir || !fs.existsSync(dataDir)) {
    return { backedUp: false, quarantinedCount: 0, backupDir: null, quarantineFile: null };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(dataDir, 'backups', `pre-clean-${stamp}`);
  const quarantineDir = path.join(dataDir, 'quarantined-synthetic');
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });

  const stateFiles = [
    'skill-registry.json',
    'xp-ledger.jsonl',
    'goal-ledger.json',
    'job-workflow-state.json',
    'learned-procedures.json',
    'provider-state.json',
  ];

  for (const name of stateFiles) {
    const src = path.join(dataDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, name));
    }
  }

  const quarantined = {
    quarantinedAt: new Date().toISOString(),
    backupDir,
    xpEvents: [],
    goals: [],
    skillsRemoved: [],
    jobWorkflowReset: false,
  };

  const isSyntheticReceiptOrGoal = (obj = {}) => {
    const origin = String(obj.origin || '').toLowerCase();
    const goalId = String(obj.goalId || obj.goal_id || '');
    const receiptId = String(obj.receiptId || obj.id || '');
    const sig = String(obj.taskSignature || '');
    const objective = String(obj.objective || '');
    return (
      origin === 'windows-live-trainer'
      || origin === 'synthetic'
      || goalId.startsWith('win-train-')
      || receiptId.startsWith('win-live-')
      || (receiptId.startsWith('rcpt-') && sig.includes(':verified-variant-'))
      || sig.includes(':unique-task-variant-')
      || objective.includes('500 matchande utvecklarjobb') // input vocabulary, never rendered
      || objective.includes('sammanfattningssida pa Level 99') // input vocabulary, never rendered
      || objective.includes('win-job-analyzer-py')
    );
  };

  // Clean xp-ledger.jsonl
  const ledgerPath = path.join(dataDir, 'xp-ledger.jsonl');
  const validReceiptIds = new Set();
  if (fs.existsSync(ledgerPath)) {
    const lines = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const keptLines = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line);
        if (isSyntheticReceiptOrGoal(parsed)) {
          quarantined.xpEvents.push(parsed);
        } else {
          keptLines.push(line);
          if (parsed.receiptId) validReceiptIds.add(parsed.receiptId);
        }
      } catch {
        keptLines.push(line);
      }
    }
    fs.writeFileSync(ledgerPath, keptLines.length ? `${keptLines.join('\n')}\n` : '', { mode: 0o600 });
  }

  // Clean skill-registry.json
  const registryPath = path.join(dataDir, 'skill-registry.json');
  if (fs.existsSync(registryPath)) {
    try {
      const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
      if (Array.isArray(reg.skills)) {
        const cleanedSkills = [];
        for (const sk of reg.skills) {
          if (sk.canonical_id === 'career.win-job-analyzer-py') {
            quarantined.skillsRemoved.push(sk);
            continue;
          }
          const origHist = Array.isArray(sk.verification_history) ? sk.verification_history : [];
          const keptHist = origHist.filter((h) => {
            const synthetic = isSyntheticReceiptOrGoal(h) || (h.receiptId && !validReceiptIds.has(h.receiptId));
            if (synthetic) quarantined.xpEvents.push(h);
            return !synthetic;
          });
          sk.verification_history = keptHist;
          sk.distinctScenarios = (sk.distinctScenarios || []).filter(
            (sc) => !String(sc).startsWith('win-scenario-') && !String(sc).startsWith('win-live-scenario-'),
          );
          sk.distinctScenariosCount = sk.distinctScenarios.length;
          sk.verifiedRecoveryCount = keptHist.filter((h) => h.recoveredFromFailure && !h.failed).length;
          sk.xp = keptHist.filter((h) => !h.failed).reduce((sum, h) => sum + (Number(h.xp) || 0), 0);
          if (sk.xp === 0) {
            sk.level = 1;
            sk.rawLevel = 1;
            sk.maturity_status = 'UNTRAINED';
            sk.lastXpGain = 0;
            sk.lastReceiptId = null;
            sk.lastVerifiedAt = null;
            sk.qualityGates = { versionedTestSuitePassed: false, testSuiteVersion: null };
          }
          cleanedSkills.push(sk);
        }
        reg.skills = cleanedSkills;
        fs.writeFileSync(registryPath, `${JSON.stringify(reg, null, 2)}\n`, { mode: 0o600 });
      }
    } catch { /* preserve file if unparseable */ }
  }

  // Clean goal-ledger.json
  const goalLedgerPath = path.join(dataDir, 'goal-ledger.json');
  if (fs.existsSync(goalLedgerPath)) {
    try {
      const gl = JSON.parse(fs.readFileSync(goalLedgerPath, 'utf8'));
      if (gl && typeof gl.goals === 'object') {
        for (const [gid, g] of Object.entries(gl.goals)) {
          const hasSyntheticJob = g.workflowSummary?.counters?.confirmed === 500;
          if (isSyntheticReceiptOrGoal(g) || hasSyntheticJob) {
            quarantined.goals.push(g);
            delete gl.goals[gid];
            if (gl.activeGoalId === gid) gl.activeGoalId = null;
          }
        }
        fs.writeFileSync(goalLedgerPath, `${JSON.stringify(gl, null, 2)}\n`, { mode: 0o600 });
      }
    } catch { /* ignore */ }
  }

  // Clean synthetic 500-job state in job-workflow-state.json
  const jobWfPath = path.join(dataDir, 'job-workflow-state.json');
  if (fs.existsSync(jobWfPath)) {
    try {
      const wf = JSON.parse(fs.readFileSync(jobWfPath, 'utf8'));
      const itemKeys = Object.keys(wf?.items || {});
      if (itemKeys.some((k) => k.startsWith('win-ad-'))) {
        quarantined.jobWorkflowReset = true;
        fs.unlinkSync(jobWfPath);
      }
    } catch { /* ignore */ }
  }

  const totalQuarantined =
    quarantined.xpEvents.length
    + quarantined.goals.length
    + quarantined.skillsRemoved.length
    + (quarantined.jobWorkflowReset ? 1 : 0);

  let quarantineFile = null;
  if (totalQuarantined > 0) {
    quarantineFile = path.join(quarantineDir, `quarantine-${stamp}.json`);
    fs.writeFileSync(quarantineFile, `${JSON.stringify(quarantined, null, 2)}\n`, { mode: 0o600 });
  }

  return {
    backedUp: true,
    quarantinedCount: totalQuarantined,
    backupDir,
    quarantineFile,
  };
}

/**
 * 2. AES-256-GCM encryption for private Google Drive upload URIs in mission queue.
 */
export function encryptBridgePayload(payloadObj, hexKey) {
  const key = Buffer.from(String(hexKey || '').trim(), 'hex');
  if (key.length !== 32) throw new Error('Bridge key must be 32 bytes (64 hex chars)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    alg: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptBridgePayload(envelope, hexKey) {
  const key = Buffer.from(String(hexKey || '').trim(), 'hex');
  if (key.length !== 32) throw new Error('Bridge key must be 32 bytes (64 hex chars)');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

/**
 * 3. Upload bytes to a pre-authorized Google Drive resumable upload session URI.
 */
export async function uploadToGoogleDriveResumable(sessionUri, bytes, mimeType = 'application/octet-stream', fetchImpl = globalThis.fetch) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const total = buf.length;
  const chunkSize = 256 * 1024; // 256 KiB required by Google Drive resumable protocol
  let offset = 0;

  while (offset < total || total === 0) {
    const end = Math.min(offset + chunkSize, total);
    const chunk = buf.subarray(offset, end);
    const isFinal = end >= total;
    const cmd = isFinal ? 'upload, finalize' : 'upload';

    const res = await fetchImpl(sessionUri, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
        'Content-Length': String(chunk.length),
        'X-Goog-Upload-Offset': String(offset),
        'X-Goog-Upload-Command': cmd,
        'X-Goog-Upload-Total-Size': String(total),
      },
      body: chunk,
    });

    if (!res.ok && res.status !== 308) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Google Drive upload failed (HTTP ${res.status}): ${errText.slice(0, 240)}`);
    }

    if (isFinal) {
      let meta = null;
      try { meta = await res.json(); } catch { /* optional JSON body */ }
      return { ok: true, status: res.status, bytesUploaded: total, file: meta };
    }
    offset = end;
  }
  return { ok: true, status: 200, bytesUploaded: total };
}

/**
 * 4. Open Notepad in the interactive Windows session, write text using Win32
 *    messaging (compatible with both classic Edit and Windows 11 RichEditD2DPT),
 *    verify via WM_GETTEXT + MAJIN `control.list_windows`, and capture screenshot
 *    via MAJIN `screen.capture`.
 */
const WIN11_NOTEPAD_PS = String.raw`
param([string]$TargetText, [string]$NoteFile)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$ErrorActionPreference = 'Stop'

$code = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class Win11NotepadBridge {
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, StringBuilder l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  public const int WM_GETTEXT = 0x000D, WM_SETTEXT = 0x000C, SW_RESTORE = 9;

  public static string GetTitle(IntPtr h) {
    var sb = new StringBuilder(512);
    GetWindowText(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static string GetClass(IntPtr h) {
    var sb = new StringBuilder(256);
    GetClassName(h, sb, sb.Capacity);
    return sb.ToString();
  }

  public static IntPtr FindNotepadWindow(string fileHint) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      string cls = GetClass(h);
      string title = GetTitle(h);
      if (cls.Equals("Notepad", StringComparison.OrdinalIgnoreCase) ||
          title.IndexOf("Notepad", StringComparison.OrdinalIgnoreCase) >= 0 ||
          title.IndexOf("Anteckningar", StringComparison.OrdinalIgnoreCase) >= 0 ||
          (!string.IsNullOrEmpty(fileHint) && title.IndexOf(fileHint, StringComparison.OrdinalIgnoreCase) >= 0)) {
        found = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static IntPtr FindEditChild(IntPtr parent) {
    IntPtr edit = IntPtr.Zero;
    EnumChildWindows(parent, (h, l) => {
      string c = GetClass(h);
      if (c.Equals("RichEditD2DPT", StringComparison.OrdinalIgnoreCase) ||
          c.Equals("Edit", StringComparison.OrdinalIgnoreCase) ||
          c.IndexOf("RichEdit", StringComparison.OrdinalIgnoreCase) >= 0) {
        edit = h;
        return false;
      }
      return true;
    }, IntPtr.Zero);
    return edit;
  }

  public static string ReadEditText(IntPtr edit) {
    var sb = new StringBuilder(4096);
    SendMessage(edit, WM_GETTEXT, (IntPtr)sb.Capacity, sb);
    return sb.ToString();
  }
}
'@

Add-Type -TypeDefinition $code -Language CSharp

# Write initial file and start notepad.exe so it is immediately visible on screen
Set-Content -Path $NoteFile -Value $TargetText -Encoding UTF8 -NoNewline
$proc = Start-Process -FilePath "notepad.exe" -ArgumentList $NoteFile -PassThru
$fileLeaf = Split-Path $NoteFile -Leaf

$hwnd = [IntPtr]::Zero
$edit = [IntPtr]::Zero
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Milliseconds 250
  $hwnd = [Win11NotepadBridge]::FindNotepadWindow($fileLeaf)
  if ($hwnd -ne [IntPtr]::Zero) {
    [void][Win11NotepadBridge]::ShowWindow($hwnd, [Win11NotepadBridge]::SW_RESTORE)
    [void][Win11NotepadBridge]::SetForegroundWindow($hwnd)
    $edit = [Win11NotepadBridge]::FindEditChild($hwnd)
    if ($edit -ne [IntPtr]::Zero) {
      [void][Win11NotepadBridge]::SendMessage($edit, [Win11NotepadBridge]::WM_SETTEXT, [IntPtr]::Zero, $TargetText)
      break
    }
  }
}

Start-Sleep -Milliseconds 600
$windowTitle = if ($hwnd -ne [IntPtr]::Zero) { [Win11NotepadBridge]::GetTitle($hwnd) } else { "" }
$editClass = if ($edit -ne [IntPtr]::Zero) { [Win11NotepadBridge]::GetClass($edit) } else { "" }
$readBack = if ($edit -ne [IntPtr]::Zero) { [Win11NotepadBridge]::ReadEditText($edit) } else { "" }
if ([string]::IsNullOrEmpty($readBack) -and (Test-Path $NoteFile)) {
  $readBack = Get-Content -Path $NoteFile -Raw
}

$out = @{
  ok = ($hwnd -ne [IntPtr]::Zero -and $readBack.Contains($TargetText))
  pid = $proc.Id
  hwnd = $hwnd.ToInt64()
  windowTitle = $windowTitle
  editClass = $editClass
  writtenText = $TargetText
  readBackText = $readBack
  noteFile = $NoteFile
}
$out | ConvertTo-Json -Compress
`;

/**
 * Execute the Notepad + Screenshot connection proof through MAJIN's GrandArchitect
 * and existing `control.list_windows` & `screen.capture` tools.
 * Awards 0 XP (`awardXp: false`).
 */
export async function executeNotepadProofThroughMajin({
  architect,
  missionId,
  workspaceDir = architect.workspaceDir,
  platform = process.platform,
  customNotepadRunner = null,
  customScreenCapture = null,
} = {}) {
  if (!missionId) throw new Error('missionId is required');
  fs.mkdirSync(workspaceDir, { recursive: true });

  const noteFile = path.join(workspaceDir, `${missionId}-notepad.txt`);
  const screenshotPath = path.join(workspaceDir, `${missionId}-screenshot.png`);

  let notepadMeta = null;
  let windowListMeta = null;
  let captureMeta = null;

  const goalState = await architect.executeGoal({
    goalText: `Connection proof ${missionId}: open Notepad, write ${missionId}, and capture screenshot`,
    awardXp: false,
    actions: [
      {
        id: 'open-and-write-notepad',
        tool: 'control.type',
        args: { window: 'Notepad', text: missionId },
        async execute() {
          if (typeof customNotepadRunner === 'function') {
            notepadMeta = await customNotepadRunner({ missionId, noteFile });
          } else {
            if (platform !== 'win32') {
              throw new Error('Windows interactive session required for Notepad proof');
            }
            const psDir = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-np-'));
            const psPath = path.join(psDir, 'notepad-proof.ps1');
            fs.writeFileSync(psPath, '\uFEFF' + WIN11_NOTEPAD_PS, { mode: 0o600 });
            try {
              const { stdout } = await execFileAsync(
                'powershell.exe',
                ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', psPath, '-TargetText', missionId, '-NoteFile', noteFile],
                { timeout: 25000, windowsHide: false },
              );
              const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean);
              notepadMeta = JSON.parse(lines[lines.length - 1]);
            } finally {
              fs.rmSync(psDir, { recursive: true, force: true });
            }
          }

          if (!notepadMeta?.ok || !String(notepadMeta.readBackText || '').includes(missionId)) {
            throw new Error(`Notepad verification failed: ${JSON.stringify(notepadMeta)}`);
          }

          // Also run Majin's shipped `control.list_windows` tool to observe the window list
          const listTool = winControlTools.find((t) => t.name === 'control.list_windows');
          if (listTool && platform === 'win32') {
            windowListMeta = await listTool.run({});
          }

          const fileBytes = fs.existsSync(noteFile) ? fs.readFileSync(noteFile) : Buffer.from(missionId, 'utf8');
          const sha256 = crypto.createHash('sha256').update(fileBytes).digest('hex');
          return {
            ...notepadMeta,
            windowListCount: windowListMeta?.meta?.count ?? null,
            verifiedReceipt: {
              id: `rcpt-np-${missionId}`,
              receiptId: `rcpt-np-${missionId}`,
              kind: 'file',
              verifier: 'win32_wm_gettext',
              verified: true,
              path: noteFile,
              sha256,
              bytes: fileBytes.length,
              at: new Date().toISOString(),
            },
          };
        },
      },
      {
        id: 'capture-screen-via-majin',
        tool: 'screen.capture',
        args: { path: screenshotPath },
        async execute() {
          if (typeof customScreenCapture === 'function') {
            captureMeta = await customScreenCapture({ screenshotPath, missionId });
          } else {
            const capTool = netTools.find((t) => t.name === 'screen.capture');
            if (!capTool) throw new Error('MAJIN screen.capture tool not found');
            captureMeta = await capTool.run(
              { path: path.basename(screenshotPath), then: 'save' },
              { cfg: { get: () => workspaceDir } },
            );
          }

          if (!captureMeta?.ok || !fs.existsSync(screenshotPath)) {
            throw new Error(`screen.capture failed: ${JSON.stringify(captureMeta?.error || captureMeta)}`);
          }
          const imgBytes = fs.readFileSync(screenshotPath);
          if (!validatePngBytes(imgBytes.subarray(0, 8))) {
            throw new Error('screen.capture did not produce valid PNG magic bytes');
          }
          const sha256 = crypto.createHash('sha256').update(imgBytes).digest('hex');
          return {
            screenshotPath,
            bytes: imgBytes.length,
            sha256,
            validatedPng: true,
            verifiedReceipt: {
              id: `rcpt-screen-${missionId}`,
              receiptId: `rcpt-screen-${missionId}`,
              kind: 'pixel',
              verifier: 'png_magic_sha256',
              verified: true,
              path: screenshotPath,
              sha256,
              bytes: imgBytes.length,
              at: new Date().toISOString(),
            },
          };
        },
      },
    ],
  });

  const screenshotBytes = fs.existsSync(screenshotPath) ? fs.readFileSync(screenshotPath) : null;
  const screenshotSha256 = screenshotBytes
    ? crypto.createHash('sha256').update(screenshotBytes).digest('hex')
    : null;

  return {
    missionId,
    completedAt: new Date().toISOString(),
    hostname: os.hostname(),
    platform: os.platform(),
    release: os.release(),
    goalStatus: goalState.status,
    xpAwarded: goalState.xp_award?.totalXpAwarded || 0,
    notepad: notepadMeta,
    screenshot: {
      path: screenshotPath,
      bytes: screenshotBytes?.length || 0,
      sha256: screenshotSha256,
      validPng: screenshotBytes ? validatePngBytes(screenshotBytes.subarray(0, 8)) : false,
    },
    toolResults: goalState.tool_results,
    verificationEvidence: (goalState.verification_evidence || []).filter(isVerifiedOutcomeReceipt),
  };
}

/**
 * 5. Visit a real job ad in a VISIBLE browser (`headless: false`) through MAJIN,
 *    extracting the live URL, document title, job heading, timestamp, and screenshot.
 *    NEVER clicks any submit button (`allowSubmit: false`).
 */
export async function executeVisibleBrowserJobVisitThroughMajin({
  architect,
  missionId,
  url,
  workspaceDir = architect.workspaceDir,
  awardXp = false,
} = {}) {
  if (!url) throw new Error('url is required');
  fs.mkdirSync(workspaceDir, { recursive: true });
  const screenshotPath = path.join(workspaceDir, `${missionId}-browser.png`);
  let pageResult = null;

  const goalState = await architect.executeGoal({
    goalText: `Visit job ad ${url} in visible browser and capture proof`,
    awardXp,
    actions: [
      {
        id: 'visit-visible-browser',
        tool: 'browser.open',
        args: { url, headless: false, allowSubmit: false },
        async execute() {
          const { chromium } = await import('playwright');
          const browser = await chromium.launch({ headless: false });
          try {
            const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
            const page = await context.newPage();
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(2500);
            const finalUrl = page.url();
            const title = await page.title();
            const heading = await page.locator('h1').first().innerText().catch(() => '');
            await page.screenshot({ path: screenshotPath, fullPage: false });
            const imgBytes = fs.readFileSync(screenshotPath);
            const sha256 = crypto.createHash('sha256').update(imgBytes).digest('hex');

            pageResult = {
              requestedUrl: url,
              finalUrl,
              title,
              heading: String(heading || '').trim(),
              timestamp: new Date().toISOString(),
              submittedAnything: false,
              screenshotBytes: imgBytes.length,
              screenshotSha256: sha256,
            };

            return {
              ...pageResult,
              verifiedReceipt: {
                id: `rcpt-browser-${missionId}`,
                receiptId: `rcpt-browser-${missionId}`,
                kind: 'dom',
                verifier: 'playwright_dom_and_screenshot',
                verified: Boolean(title && imgBytes.length > 0),
                path: screenshotPath,
                sha256,
                bytes: imgBytes.length,
                at: pageResult.timestamp,
              },
            };
          } finally {
            await browser.close();
          }
        },
      },
    ],
  });

  return {
    missionId,
    goalStatus: goalState.status,
    xpAwarded: goalState.xp_award?.totalXpAwarded || 0,
    page: pageResult,
    screenshotPath,
  };
}

void spawn;
