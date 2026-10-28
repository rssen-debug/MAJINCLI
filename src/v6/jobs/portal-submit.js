/**
 * MAJIN V6 — employer-portal submission adapter.
 *
 * This replaces the `SUBMISSION_ADAPTER_NOT_CONFIGURED` gap with a real,
 * testable adapter. It is deliberately separated from the browser tools so the
 * generic ATS behaviour (Teamtailor, Greenhouse, generic forms) is unit-testable
 * against a fake driver and never depends on a live employer page for its tests.
 *
 * Safety invariants (see handlers.js `job.submit`):
 *  - a submission only runs when the queued task is marked `irreversible`;
 *  - a click is never treated as receipt: a confirmation must be observed;
 *  - CAPTCHA / MFA / login are returned as owner-required blockers, never bypassed.
 */
import path from 'node:path';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { priorApplication, readPriorLedger } from './submission-guard.js';
import { withFileLock } from '../util.js';
import { transitionApplication } from './state.js';

const CONFIRM_PATTERN = /thanks for applying|(?:we have |we've )?received your application|your application (?:has been |was )?(?:received|submitted)|application submitted|tack för din ansökan|(?:vi har )?mottagit din ansökan|ansökan (?:är )?(?:mottagen|skickad|registrerad)|tak for din ansøgning|(?:din )?ansøgning (?:er )?(?:sendt|modtaget)/i;

const BLOCKER_PATTERNS = [
  { code: 'CAPTCHA', pattern: /recaptcha|hcaptcha|cloudflare.*turnstile|captcha/i },
  { code: 'MFA', pattern: /two[-\s]?factor|multi[-\s]?factor|one[-\s]?time code|authenticator|verification code/i },
  { code: 'LOGIN', pattern: /(?:log\s*in|sign\s*in|username|password) required/i },
];

const SELECTORS = {
  first: ['#candidate_first_name', '#firstname', 'input[name="first_name"]', 'input[name="firstname"]', 'input[name="firstName"]'],
  last: ['#candidate_last_name', '#lastname', 'input[name="last_name"]', 'input[name="lastname"]', 'input[name="lastName"]'],
  email: ['#candidate_email', '#email', 'input[type="email"]', 'input[name="email"]'],
  phone: ['#candidate_phone', '#phone', 'input[type="tel"]', 'input[name="phone"]', 'input[name="mobile_phone_number"]'],
  coverLetter: ['#candidate_job_applications_attributes_0_cover_letter', 'textarea[name*="cover"]', 'textarea[name*="message"]', 'textarea[name*="motivation"]'],
  consent: ['#candidate_consent_given', 'input[type="checkbox"][name*="consent"]', '#acceptterms', 'input[type="checkbox"][name*="privacy"]'],
  cv: ['#candidate_resume_remote_url', '#candidate_file_remote_url', 'input[type="file"][name="resume"]', 'input[type="file"][name="cv"]'],
  submit: ['button[type="submit"]', 'input[type="submit"]', 'button:has-text("Skicka ansökan")', 'button:has-text("Submit application")', 'button:has-text("Send application")', 'button:has-text("Apply")', '#quick-apply-submit-btn'], // input vocabulary, never rendered
};

export function detectPortal(url = '') {
  const u = String(url || '').toLowerCase();
  if (u.includes('bellagroup.dk')) return 'bellagroup';
  if (u.includes('teamtailor') || u.includes('recruitondemand')) return 'teamtailor';
  if (u.includes('greenhouse') || u.includes('job-boards.greenhouse')) return 'greenhouse';
  if (u.includes('ashbyhq.com')) return 'ashby';
  return 'generic';
}

/**
 * Fill one candidate profile into the current page using best-effort, portal-
 * aware selectors. `driver` exposes: open, text, url, fill, check, select,
 * upload, click, wait.
 */
export async function fillCandidate(driver, profile, cvPath, portal) {
  let cvUploaded = false;
  // Reachmee (and some other ATS forms) reset the visible fields when a file
  // upload completes. Upload FIRST, wait for the async upload, then fill text.
  // This ordering was verified on Formas' Reachmee form on 2026-10-27.
  if (cvPath) {
    const abs = path.resolve(cvPath);
    for (const selector of SELECTORS.cv) {
      const uploaded = await driver.upload(selector, abs);
      if (uploaded) { cvUploaded = true; break; }
    }
    await driver.wait(1200);
  }
  const values = {
    first: profile?.firstName || '',
    last: profile?.lastName || '',
    email: profile?.contactEmail || '',
    phone: profile?.phone || '',
  };
  const filledIdentity = new Set();
  for (const [kind, value] of Object.entries(values)) {
    if (!value) continue;
    for (const selector of SELECTORS[kind] || []) {
      const filled = await driver.fill(selector, value);
      if (filled) { filledIdentity.add(kind); break; }
    }
  }
  const cover = profile?.coverLetter || '';
  if (cover) {
    for (const selector of SELECTORS.coverLetter) {
      const filled = await driver.fill(selector, cover);
      if (filled) break;
    }
  }
  for (const selector of SELECTORS.consent) {
    await driver.check(selector);
  }
  await driver.wait(800);
  return { cvUploaded, fieldsVerified: ['first', 'last', 'email'].every(key => filledIdentity.has(key)) && await driver.validateForm?.() === true };
}

export async function fillBellagroup(driver, { profile, cvPath, coverLetter }) {
  const first = profile?.firstName || '';
  const last = profile?.lastName || '';
  const email = profile?.contactEmail || '';
  const phone = profile?.phone || '';
  let cvUploaded = false;
  if (cvPath) {
    cvUploaded = await driver.uploadNth('input[type="file"]', 1, path.resolve(cvPath));
    await driver.wait(1500);
  }
  await driver.fill('input[formcontrolname="name"]', `${first} ${last}`);
  await driver.fill('input[formcontrolname="email"]', email);
  await driver.fill('input[formcontrolname="emailVerification"]', email);
  await driver.fill('input[formcontrolname="addressStreet1"]', profile?.addressStreet || '');
  await driver.fill('input[formcontrolname="addressZipPostalCode"]', profile?.postalCode || '');
  await driver.fill('input[formcontrolname="addressCity"]', profile?.city || '');
  if (profile?.country) await driver.selectLabel('select[formcontrolname="addressCountryRegion"]', profile.country);
  await driver.fill('input[formcontrolname="mobilePhone"]', phone);
  await driver.selectValue('select[formcontrolname="advertisementReference"]', '05');
  await driver.fill('textarea[formcontrolname="commentNote"]', String(coverLetter || '').slice(0, 6000));
  await driver.check('input[formcontrolname="allowSave"]');
  await driver.wait(1000);
  return { cvUploaded, fieldsVerified: await driver.validateForm?.() === true };
}

export async function detectBlocker(driver) {
  const text = await driver.text();
  for (const blocker of BLOCKER_PATTERNS) {
    if (blocker.pattern.test(text)) {
      return { code: blocker.code, requiresOwner: true, reason: `${blocker.code} detected on the portal; owner must complete it in the browser session.` };
    }
  }
  return null;
}

export async function clickSubmit(driver) {
  for (const selector of SELECTORS.submit) {
    const clicked = await driver.click(selector);
    if (clicked) return true;
  }
  return false;
}

/**
 * Submit a single application through an employer portal.
 * Returns { ok:true, evidence } on a verified receipt,
 * { blocked } for CAPTCHA/MFA/login or missing authorization, and
 * { ok:false, error } when a click did not produce a confirmation.
 */
export async function submitPortal(driver, { application, profile, cvPath, authorized = false, allowedOrigins = [], beforeSubmit, evidenceDir }) {
  if (!authorized) return { blocked: { code: 'SUBMISSION_NOT_AUTHORIZED', requiresOwner: true, reason: 'Explicit submission approval is required before touching the form.' } };
  const job = application?.job || application || {};
  const url = job.apply?.url || job.url || '';
  if (!url) {
    return { ok: false, retryable: false, error: { code: 'PORTAL_URL_MISSING', reason: 'No canonical application URL available.' } };
  }
  const allowed = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && allowedOrigins.includes(u.origin); } catch { return false; } };
  if (!allowed(url)) return { blocked: { code: 'PORTAL_ORIGIN_NOT_GRANTED', requiresOwner: true, reason: 'The exact application origin is not granted.' } };
  if (!profile?.firstName || !profile?.lastName || !profile?.contactEmail) return { blocked: { code: 'CANDIDATE_FIELDS_MISSING', requiresOwner: true, reason: 'Verified candidate name and email are required.' } };
  if (!cvPath || !fs.existsSync(cvPath)) return { blocked: { code: 'CV_FILE_MISSING', requiresOwner: true, reason: 'The candidate CV is missing.' } };
  await driver.open(url);
  if (!allowed(await driver.url())) return { blocked: { code: 'PORTAL_REDIRECT_NOT_GRANTED', requiresOwner: true, reason: 'Redirected to an unapproved origin.' } };
  const portal = detectPortal(url);
  await driver.wait(600);

  const blocker = await detectBlocker(driver);
  if (blocker) return { blocked: blocker };

  const prepared = portal === 'bellagroup'
    ? await fillBellagroup(driver, { profile, cvPath, coverLetter: profile?.coverLetter || '' })
    : await fillCandidate(driver, profile, cvPath, portal);
  if (!prepared.cvUploaded) return { blocked: { code: 'CV_UPLOAD_NOT_VERIFIED', requiresOwner: false, reason: 'The CV file was not observed in the upload input.' } };
  if (!prepared.fieldsVerified) return { blocked: { code: 'FORM_FIELDS_NOT_VERIFIED', requiresOwner: true, reason: 'Required form fields are missing or invalid.' } };

  if (!authorized) {
    return { blocked: { code: 'SUBMISSION_NOT_AUTHORIZED', requiresOwner: true, reason: 'The task is not authorized (irreversible=false) or the portal origin is not granted.' } };
  }

  const blocker2 = await detectBlocker(driver);
  if (blocker2) return { blocked: blocker2 };
  if (!allowed(await driver.url())) return { blocked: { code: 'PORTAL_REDIRECT_NOT_GRANTED', requiresOwner: true, reason: 'Form origin changed before submission.' } };
  const beforeText = await driver.text();
  if (CONFIRM_PATTERN.test(beforeText)) return { blocked: { code: 'EXISTING_CONFIRMATION', requiresOwner: true, reason: 'A confirmation was already visible before submit; reconcile instead of repeating.' } };
  if (typeof beforeSubmit !== 'function') return { blocked: { code: 'SUBMIT_CHECKPOINT_REQUIRED', requiresOwner: false, reason: 'Durable submit intent must be recorded before clicking.' } };
  const cvEvidence = { cvFileName: path.basename(cvPath), cvSha256: createHash('sha256').update(fs.readFileSync(cvPath)).digest('hex'), fieldsVerified: true };
  await beforeSubmit(cvEvidence);
  let submitted;
  try { submitted = await clickSubmit(driver); }
  catch { return { uncertain: { code: 'SUBMIT_OUTCOME_UNKNOWN', reason: 'Click failed after durable intent; do not retry automatically.' } }; }
  await driver.wait(1200);
  const text = await driver.text();
  const finalUrl = await driver.url();

  const confirmed = allowed(finalUrl) && text !== beforeText && CONFIRM_PATTERN.test(text);
  let evidencePath = null;
  if (evidenceDir) {
    fs.mkdirSync(evidenceDir, { recursive: true });
    evidencePath = await driver.screenshot?.(path.join(evidenceDir, `submission-${Date.now()}.png`));
  }
  if (!submitted || !confirmed) {
    return {
      ok: false,
      retryable: false,
      uncertain: { code: 'SUBMISSION_NOT_CONFIRMED', reason: 'Submission may have occurred; reconcile before any retry.' },
      error: { code: 'SUBMISSION_NOT_CONFIRMED', reason: `Submit click ${submitted ? 'executed' : 'not matched'} but no confirmation was observed. A click is not a receipt.` },
      evidence: { url: finalUrl, textSnippet: text.slice(0, 300) },
    };
  }

  return {
    ok: true,
    evidence: {
      confirmed: true,
      kind: 'portal-confirmation',
      ...cvEvidence,
      evidencePath,
      url: finalUrl,
      at: new Date().toISOString(),
      dedupeId: `${portal}:${application?.id || ''}`,
      reference: finalUrl,
      textSnippet: text.slice(0, 300),
    },
    summary: `Application submitted and confirmed via ${portal} portal.`,
  };
}

/**
 * Factory that wires the adapter to the V6 hunter/context. The returned
 * function has the `submitAdapter(ctx)` contract expected by handlers.js.
 */
export function createPortalSubmitAdapter({ hunter = null, profiles = null, log = null, ownerGrantsFile, priorLedgerFiles = {}, evidenceDir, driverFactory }) {
  return async (ctx) => {
    const applicationId = ctx?.task?.payload?.applicationId;
    const candidateId = ctx?.task?.payload?.candidateId;
    let application = applicationId && hunter?.store?.get
      ? await hunter.store.get(applicationId)
      : null;
    if (!application) {
      return { ok: false, retryable: false, error: { code: 'APPLICATION_UNKNOWN', reason: `No stored application for ${applicationId || candidateId || '(missing id)'}` } };
    }
    const blocked = (code, reason) => ({ blocked: { code, reason, requiresOwner: true } });
    if (application.candidateId !== candidateId) return blocked('CANDIDATE_MISMATCH', 'Task and application candidates differ.');
    if (application.state !== 'APPROVED' || !application.history?.some(h => h.state === 'APPROVED' && h.evidence?.approvalRef)) return blocked('APPLICATION_NOT_APPROVED', `Application is ${application.state}; an explicit approval reference is required.`);
    if (ctx.task.irreversible !== true) return blocked('SUBMISSION_NOT_AUTHORIZED', 'Submission must be an irreversible task.');
    let allowedOrigins;
    try {
      const entries = [...await hunter.store.list({ candidateId, limit: 10000 }), ...readPriorLedger(priorLedgerFiles[candidateId])];
      if (priorApplication(application, entries)) return blocked('PRIOR_APPLICATION_FOUND', 'Prior application or uncertain submission found; reconcile instead of resending.');
      const grants = JSON.parse(fs.readFileSync(ownerGrantsFile, 'utf8'));
      if (!grants.lanes?.includes('browser')) return blocked('BROWSER_NOT_GRANTED', 'Browser lane is not granted.');
      const origin = new URL(application.job.apply?.url || application.job.url).origin;
      allowedOrigins = grants.browserOrigins?.includes('*') ? [origin] : (grants.browserOrigins || []);
    } catch { return blocked('SUBMISSION_CONTEXT_UNAVAILABLE', 'Cannot read candidate ledger or current browser grants.'); }
    const quota = await hunter.quotaStatus(candidateId);
    if (!quota.allowed) return blocked('DAILY_QUOTA_REACHED', 'Candidate daily submission quota reached.');
    const candidate = (profiles?.candidates || []).find((c) => c.id === application.candidateId) || {};
    const profile = {
      firstName: candidate.displayName?.split(' ')[0] || candidate.id || '',
      lastName: (candidate.displayName?.split(' ').slice(1).join(' ')) || '',
      contactEmail: candidate.contactEmail || '',
      phone: candidate.phone || '',
      addressStreet: candidate.addressStreet || '',
      postalCode: candidate.postalCode || '',
      city: candidate.city || '',
      country: candidate.country || '',
      coverLetter: candidate.coverLetter || '',
    };
    const authorized = ctx?.task?.irreversible === true;
    let driver;
    let intentSaved = false;
    try {
      const { createPlaywrightDriver } = await import('./portal-driver.js');
      driver = await (driverFactory || createPlaywrightDriver)({ log });
      const result = await submitPortal(driver, { application, profile, cvPath: candidate.cvPath, authorized, allowedOrigins, evidenceDir,
        beforeSubmit: async evidence => {
          if (ctx.signal?.aborted) throw new Error('Submission cancelled before intent');
          const lockPath = `${priorLedgerFiles[candidateId]}.submit.lock`;
          await withFileLock(lockPath, async () => {
          const entries = [...await hunter.store.list({ candidateId, limit: 10000 }), ...readPriorLedger(priorLedgerFiles[candidateId])];
          if (priorApplication(application, entries)) throw new Error('Prior submission found before submit intent');
          const currentQuota = await hunter.quotaStatus(candidateId);
          if (!currentQuota.allowed) throw new Error('Candidate quota reached before submit intent');
          const stored = await hunter.store.get(application.id);
          if (stored.state !== 'APPROVED') throw new Error('Application state changed before submit');
          transitionApplication(stored, 'FORM_STARTED', { by: 'portal-adapter', evidence: { portalUrl: stored.job.apply?.url || stored.job.url } });
          transitionApplication(stored, 'FORM_PREPARED', { by: 'portal-adapter', evidence });
          transitionApplication(stored, 'SUBMITTING', { by: 'portal-adapter', evidence });
          await hunter.store.save(stored, { event: 'submit-intent' });
          intentSaved = true;
          }, { staleMs: Infinity });
        },
      });
      if (!result.ok) {
        if (intentSaved) {
          const stored = await hunter.store.get(application.id);
          transitionApplication(stored, 'UNCERTAIN', { by: 'portal-adapter', evidence: { reason: 'No observed receipt after submit intent' } });
          await hunter.store.save(stored, { event: 'submit-uncertain' });
        }
        return result;
      }
      const recorded = await hunter.recordSubmission({
        applicationId: application.id,
        receipt: result.evidence,
        portalUrl: application.job.apply?.url || application.job.url,
      });
      if (!recorded.ok) return { uncertain: { code: 'RECEIPT_PERSIST_FAILED', reason: 'Observed portal receipt could not be persisted; do not resubmit.' } };
      return { ...result, state: recorded.state || null, recordSummary: recorded.summary || null };
    } catch (error) {
      if (intentSaved) return { uncertain: { code: 'SUBMIT_OUTCOME_UNKNOWN', reason: 'Failure after durable submit intent; reconcile before retrying.' } };
      return { ok: false, retryable: false, error: { code: 'PORTAL_DRIVER_UNAVAILABLE', reason: String(error?.message || error).slice(0, 500) } };
    } finally {
      await driver?.close?.();
    }
  };
}
