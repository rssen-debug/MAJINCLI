import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { GrandArchitect, TASK_STATUS } from '../../src/v5/architect.js';
import { JobApplicationWorkflow } from '../../src/v5/workflows/job-search.js';
import { isVerifiedOutcomeReceipt } from '../../src/v5/xp-engine.js';
import {
  decryptBridgePayload,
  encryptBridgePayload,
  executeNotepadProofThroughMajin,
  quarantineSyntheticHistory,
  uploadToGoogleDriveResumable,
} from '../../src/v5/desktop-bridge.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'majin-v5-bridge-test-'));
}

test('XP guard rejects synthetic trainer origins and JobApplicationWorkflow refuses mocked confirmations without portalAdapter', async () => {
  assert.equal(
    isVerifiedOutcomeReceipt({
      id: 'rcpt-1',
      kind: 'file',
      verified: true,
      origin: 'windows-live-trainer',
    }),
    false,
    'Synthetic windows-live-trainer origin must never count as a verified receipt',
  );

  assert.equal(
    isVerifiedOutcomeReceipt({
      id: 'win-live-doc-1',
      kind: 'file',
      verified: true,
    }),
    false,
    'win-live-* synthetic receipt IDs must be rejected',
  );

  const dir = tmpDir();
  const wf = new JobApplicationWorkflow({ dataDir: dir, portalAdapter: null });
  const summary = await wf.run({
    cvText: 'Namn: Test Person\nE-post: test@example.com\n6 års erfarenhet av TypeScript och Node.js.', // input vocabulary, never rendered
    jobAds: [
      {
        id: 'real-ad-1',
        title: 'TypeScript Developer',
        employer: 'Fellowmind',
        location: 'Stockholm',
        requiredSkills: ['typescript', 'node.js'],
      },
    ],
    mandate: { allowSubmit: true },
  });

  assert.equal(summary.counters.matched, 1);
  assert.equal(summary.counters.prepared, 1);
  assert.equal(summary.counters.submitted, 0, 'Must never mock submission without a real portalAdapter');
  assert.equal(summary.counters.confirmed, 0, 'Must never mock confirmation without a real portalAdapter');
  assert.equal(summary.counters.failed, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('quarantineSyntheticHistory backs up dataDir, quarantines synthetic training records, and preserves real user data', () => {
  const dir = tmpDir();

  // Seed provider-state.json (real user config)
  const providerPath = path.join(dir, 'provider-state.json');
  fs.writeFileSync(
    providerPath,
    JSON.stringify({ activeProvider: 'opencode-go', activeModelId: 'Kimi K3.1 Pro' }, null, 2),
    'utf8',
  );

  // Seed xp-ledger.jsonl with 1 real event and 2 synthetic trainer events
  const ledgerPath = path.join(dir, 'xp-ledger.jsonl');
  const realEvent = {
    eventId: 'ev-real-1',
    receiptId: 'rcpt-real-doc-1',
    goalId: 'goal-real-1',
    skillId: 'documents.read',
    xp: 24,
    origin: 'local-verifier',
    taskSignature: 'real-doc-read',
  };
  const fakeEvent1 = {
    eventId: 'ev-fake-1',
    receiptId: 'rcpt-documents.read-1',
    goalId: 'win-train-documents.read-1',
    skillId: 'documents.read',
    xp: 60,
    origin: 'windows-live-trainer',
    taskSignature: 'documents.read:verified-variant-1',
  };
  fs.writeFileSync(ledgerPath, `${JSON.stringify(realEvent)}\n${JSON.stringify(fakeEvent1)}\n`, 'utf8');

  // Seed job-workflow-state.json with synthetic win-ad-1
  const wfPath = path.join(dir, 'job-workflow-state.json');
  fs.writeFileSync(
    wfPath,
    JSON.stringify({ items: { 'win-ad-1': { jobId: 'win-ad-1', confirmed: true } } }),
    'utf8',
  );

  const report = quarantineSyntheticHistory(dir);
  assert.equal(report.backedUp, true);
  assert.ok(fs.existsSync(path.join(report.backupDir, 'xp-ledger.jsonl')));
  assert.ok(report.quarantinedCount >= 2);
  assert.ok(fs.existsSync(report.quarantineFile));

  // Verify real event and provider config are preserved, while synthetic records are removed
  const remainingLines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
  assert.equal(remainingLines.length, 1);
  assert.equal(JSON.parse(remainingLines[0]).receiptId, 'rcpt-real-doc-1');
  assert.equal(fs.existsSync(wfPath), false);
  assert.equal(JSON.parse(fs.readFileSync(providerPath, 'utf8')).activeModelId, 'Kimi K3.1 Pro');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('Bridge AES-256-GCM encryption, zero-XP Notepad proof through GrandArchitect, and Google Drive resumable upload', async () => {
  const dir = tmpDir();
  const key = crypto.randomBytes(32).toString('hex');
  const secretUris = {
    screenshotUploadUri: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test1',
    resultUploadUri: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test2',
  };

  const encrypted = encryptBridgePayload(secretUris, key);
  const decrypted = decryptBridgePayload(encrypted, key);
  assert.deepEqual(decrypted, secretUris);

  const architect = new GrandArchitect({ dataDir: dir });
  const missionId = 'MISSION-ARENA-NP-TEST01';

  // Valid minimal PNG header + IEND
  const validPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  );

  const outcome = await executeNotepadProofThroughMajin({
    architect,
    missionId,
    platform: 'win32',
    customNotepadRunner: async ({ noteFile }) => {
      fs.writeFileSync(noteFile, missionId, 'utf8');
      return {
        ok: true,
        pid: 4242,
        hwnd: 100200,
        windowTitle: `${missionId}-notepad.txt - Notepad`,
        editClass: 'RichEditD2DPT',
        writtenText: missionId,
        readBackText: missionId,
        noteFile,
      };
    },
    customScreenCapture: async ({ screenshotPath }) => {
      fs.writeFileSync(screenshotPath, validPng);
      return { ok: true, meta: { path: screenshotPath, bytes: validPng.length, validatedPng: true } };
    },
  });

  assert.equal(outcome.goalStatus, TASK_STATUS.COMPLETED);
  assert.equal(outcome.xpAwarded, 0, 'Connection proof must award 0 XP');
  assert.equal(outcome.notepad.readBackText, missionId);
  assert.equal(outcome.screenshot.validPng, true);

  // Verify Google Drive resumable upload chunking & headers
  const calls = [];
  const upRes = await uploadToGoogleDriveResumable(
    secretUris.screenshotUploadUri,
    validPng,
    'image/png',
    async (uri, init) => {
      calls.push({ uri, headers: init.headers, bodyLen: init.body.length });
      return {
        ok: true,
        status: 200,
        async json() { return { id: 'drive-file-123' }; },
      };
    },
  );
  assert.equal(upRes.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['X-Goog-Upload-Command'], 'upload, finalize');
  assert.equal(calls[0].headers['X-Goog-Upload-Total-Size'], String(validPng.length));

  fs.rmSync(dir, { recursive: true, force: true });
});
