import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { submitPortal, createPortalSubmitAdapter } from '../../src/v6/jobs/portal-submit.js';
import { priorApplication, applicationUrl } from '../../src/v6/jobs/submission-guard.js';
import { JobStore } from '../../src/v6/jobs/store.js';
import { transitionApplication } from '../../src/v6/jobs/state.js';

test('dedupe preserves job identifiers in query strings while removing tracking', () => {
  assert.notEqual(applicationUrl('https://example.test/apply?job=1'), applicationUrl('https://example.test/apply?job=2'));
  assert.equal(applicationUrl('https://example.test/jobs/1/applications/new?utm_source=x'), applicationUrl('https://example.test/jobs/1'));
});

function fixture(t, overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'submit-guard-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cvPath = path.join(dir, 'cv.pdf'); fs.writeFileSync(cvPath, 'fixture CV');
  let clicks = 0, opens = 0, intent = false;
  const url = 'https://example.test/apply';
  const driver = { open: async () => { opens++; }, url: async () => url,
    text: async () => clicks ? 'We have received your application.' : 'Apply for this role',
    upload: async () => true, fill: async () => true, check: async () => true,
    validateForm: async () => true, wait: async () => {},
    click: async () => { assert.equal(intent, true); clicks++; return true; }, ...overrides };
  const options = { application: { id: 'a', job: { url } }, profile: { firstName: 'Test', lastName: 'Candidate', contactEmail: 'candidate@example.test' },
    cvPath, authorized: true, allowedOrigins: ['https://example.test'], beforeSubmit: async () => { intent = true; } };
  return { driver, options, clicks: () => clicks, opens: () => opens };
}
test('missing upload blocks all submit clicks', async t => {
  const f = fixture(t, { upload: async () => false });
  assert.equal((await submitPortal(f.driver, f.options)).blocked.code, 'CV_UPLOAD_NOT_VERIFIED');
  assert.equal(f.clicks(), 0);
});
test('invalid fields block submission after upload', async t => {
  const f = fixture(t, { validateForm: async () => false });
  assert.equal((await submitPortal(f.driver, f.options)).blocked.code, 'FORM_FIELDS_NOT_VERIFIED');
  assert.equal(f.clicks(), 0);
});
test('authorization is checked before opening or uploading', async t => {
  const f = fixture(t); f.options.authorized = false;
  assert.equal((await submitPortal(f.driver, f.options)).blocked.code, 'SUBMISSION_NOT_AUTHORIZED');
  assert.equal(f.opens(), 0);
});
test('a redirected origin cannot receive candidate data', async t => {
  const f = fixture(t, { url: async () => 'https://unapproved.test/form', upload: async () => { throw Error('must not upload'); } });
  assert.equal((await submitPortal(f.driver, f.options)).blocked.code, 'PORTAL_REDIRECT_NOT_GRANTED');
});
test('durable intent precedes click and confirmed receipt includes CV digest', async t => {
  const f = fixture(t); const r = await submitPortal(f.driver, f.options);
  assert.equal(f.clicks(), 1); assert.equal(r.ok, true); assert.equal(r.evidence.kind, 'portal-confirmation');
  assert.match(r.evidence.cvSha256, /^[a-f0-9]{64}$/);
});
test('existing confirmation cannot trigger another application', async t => {
  const f = fixture(t, { text: async () => 'We have received your application.' });
  assert.equal((await submitPortal(f.driver, f.options)).blocked.code, 'EXISTING_CONFIRMATION'); assert.equal(f.clicks(), 0);
});
test('generic thanks or application wording is not a receipt', async t => {
  const f = fixture(t, { text: async () => 'Thank you for visiting. Bekräfta din ansökan.' });
  const r = await submitPortal(f.driver, f.options); assert.equal(r.ok, false); assert.equal(r.uncertain.code, 'SUBMISSION_NOT_CONFIRMED');
});
test('cross-ledger employer/title aliases block a previous application with a different ID', () => {
  const app = { id: 'new', candidateId: 'lavinia', job: { company: 'Hairplant ApS', title: 'Junior Content Creator / Videographer', url: 'https://jobindex.dk/new' } };
  const row = { jobId: 'old', profile: 'lavinia', employer: 'Hairplant', title: 'Junior Content Creator / Videographer (Copenhagen)', status: 'waiting' };
  assert.equal(priorApplication(app, [row]), row);
  assert.equal(priorApplication(app, [{ ...row, profile: 'kristjan' }]), undefined);
});
test('factory refuses unapproved or wrong-candidate jobs before browser creation', async () => {
  const adapter = createPortalSubmitAdapter({ hunter: { store: { get: async () => ({ candidateId: 'lavinia', state: 'MATCHED' }) } }, driverFactory: async () => { throw Error('must not launch'); } });
  const result = await adapter({ task: { irreversible: true, payload: { applicationId: 'a', candidateId: 'lavinia' } } });
  assert.equal(result.blocked.code, 'APPLICATION_NOT_APPROVED');
});

test('lost response leaves durable uncertainty and restart cannot click again', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'submit-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'jobs.json');
  const store = new JobStore({ file });
  const { application } = await store.upsertDiscovered({ title: 'Content Producer', company: 'Example', url: 'https://example.test/apply' }, 'candidate');
  transitionApplication(application, 'MATCHED', { evidence: { score: 0.8 } });
  transitionApplication(application, 'APPROVED', { evidence: { approvalRef: 'test-owner-approval' } });
  await store.save(application);
  const cvPath = path.join(dir, 'resume.pdf'); fs.writeFileSync(cvPath, 'test CV');
  const ledger = path.join(dir, 'legacy.json'); fs.writeFileSync(ledger, '[]');
  const grants = path.join(dir, 'grants.json'); fs.writeFileSync(grants, JSON.stringify({ lanes: ['browser'], browserOrigins: ['https://example.test'] }));
  let clicks = 0;
  const driver = { open: async () => {}, url: async () => 'https://example.test/apply', text: async () => 'Apply now',
    fill: async () => true, upload: async () => true, validateForm: async () => true, check: async () => true, wait: async () => {}, close: async () => {},
    click: async () => { assert.equal((await new JobStore({ file }).get(application.id)).state, 'SUBMITTING'); clicks++; throw Error('connection lost'); } };
  const adapter = createPortalSubmitAdapter({ hunter: { store, quotaStatus: async () => ({ allowed: true }) },
    profiles: { candidates: [{ id: 'candidate', displayName: 'Test Candidate', contactEmail: 'candidate@example.test', cvPath }] },
    ownerGrantsFile: grants, priorLedgerFiles: { candidate: ledger }, driverFactory: async () => driver });
  const ctx = { task: { irreversible: true, payload: { applicationId: application.id, candidateId: 'candidate' } } };
  assert.equal((await adapter(ctx)).uncertain.code, 'SUBMIT_OUTCOME_UNKNOWN');
  assert.equal((await new JobStore({ file }).get(application.id)).state, 'UNCERTAIN');
  assert.equal((await adapter(ctx)).blocked.code, 'APPLICATION_NOT_APPROVED');
  assert.equal(clicks, 1);
});
