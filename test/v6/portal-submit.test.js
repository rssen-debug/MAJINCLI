import test from 'node:test';
import assert from 'node:assert';
import { submitPortal as submitRaw, detectPortal } from '../../src/v6/jobs/portal-submit.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-test-'));
const cvPath = path.join(temp, 'cv.pdf');
fs.writeFileSync(cvPath, 'test fixture only');
after(() => fs.rmSync(temp, { recursive: true, force: true }));
const submitPortal = (driver, options) => submitRaw(driver, { ...options, cvPath, allowedOrigins: ['https://ex.teamtailor.com', 'https://karriere.bellagroup.dk'], beforeSubmit: async () => {} });

function fakeDriver({ url = 'https://ex.teamtailor.com/jobs/1/applications/new', afterSubmitText = 'Thanks for applying! We have received your application.', text = '' } = {}) {
  const state = { url, afterSubmitText, text };
  return {
    async open(u) { state.url = u; return true; },
    async text() { return state.text || state.url; },
    async url() { return state.url; },
    async fill() { return true; },
    async check() { return true; },
    async select() { return true; },
    async upload() { return true; },
    async validateForm() { return true; },
    async uploadNth() { return true; },
    async checkNth() { return true; },
    async fillNth() { return true; },
    async selectLabel() { return true; },
    async selectValue() { return true; },
    async click() { state.text = state.afterSubmitText; return true; },
    async wait() { return undefined; },
  };
}

test('detectPortal recognises common ATS hosts', () => {
  assert.equal(detectPortal('https://foo.teamtailor.com/jobs/1'), 'teamtailor');
  assert.equal(detectPortal('https://job-boards.greenhouse.io/x/jobs/1'), 'greenhouse');
  assert.equal(detectPortal('https://jobs.ashbyhq.com/x/1'), 'ashby');
  assert.equal(detectPortal('https://example.com/apply'), 'generic');
});

test('submitPortal returns a confirmed receipt when the portal confirms', async () => {
  const driver = fakeDriver();
  const result = await submitPortal(driver, {
    application: { id: 'app1', job: { url: 'https://ex.teamtailor.com/jobs/1/applications/new' } },
    profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath: 'C:/fake/cv.pdf',
    authorized: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.confirmed, true);
  assert.equal(result.evidence.dedupeId, 'teamtailor:app1');
});

test('submitPortal does NOT fabricate a receipt when a click yields no confirmation', async () => {
  const driver = fakeDriver({ afterSubmitText: 'Please complete the form.' });
  const result = await submitPortal(driver, {
    application: { id: 'app2', job: { url: 'https://ex.teamtailor.com/jobs/2/applications/new' } },
    profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath: 'C:/fake/cv.pdf',
    authorized: true,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'SUBMISSION_NOT_CONFIRMED');
});

test('submitPortal blocks on CAPTCHA instead of bypassing it', async () => {
  const driver = fakeDriver({ text: 'Complete the reCAPTCHA challenge to continue.' });
  const result = await submitPortal(driver, {
    application: { id: 'app3', job: { url: 'https://ex.teamtailor.com/jobs/3/applications/new' } },
    profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath: 'C:/fake/cv.pdf',
    authorized: true,
  });
  assert.equal(result.blocked.code, 'CAPTCHA');
  assert.equal(result.blocked.requiresOwner, true);
});

test('submitPortal refuses an unauthorized submission', async () => {
  const driver = fakeDriver();
  const result = await submitPortal(driver, {
    application: { id: 'app4', job: { url: 'https://ex.teamtailor.com/jobs/4/applications/new' } },
    profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath: 'C:/fake/cv.pdf',
    authorized: false,
  });
  assert.equal(result.blocked.code, 'SUBMISSION_NOT_AUTHORIZED');
});


test('submitPortal recognises a Danish Bellagroup confirmation', async () => {
  const driver = fakeDriver({ afterSubmitText: 'Tak for din ansøgning hos Bellagroup' });
  const result = await submitPortal(driver, {
    application: { id: 'bella1', job: { url: 'https://karriere.bellagroup.dk/application?applicationId=1300' } },
    profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath: 'C:/fake/cv.pdf',
    authorized: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.evidence.confirmed, true);
});
