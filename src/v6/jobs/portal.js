/**
 * MAJIN V6 — owner-authored HTTP submission adapter.
 *
 * This is the only code path that can send an application. It is deliberately
 * narrow:
 *   - the endpoint, origin and field mapping come from the owner's config file;
 *   - HTTPS is required (plain HTTP only for an explicit loopback test target);
 *   - the CV file must exist and be readable before anything is sent;
 *   - a submission is only SUBMITTED when the portal returned an acknowledgement
 *     matching the configured rule; anything else is UNCERTAIN, never "maybe ok";
 *   - the response is stored as evidence locally and is never uploaded raw.
 */
import fs from 'node:fs';
import path from 'node:path';
import { transitionApplication } from './state.js';
import { ArenaError } from '../arena/envelope.js';

export const PORTAL_SCHEMA = 'majin.v6.portal/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function loadPortalAdapters(file, { fsImpl = fs } = {}) {
  if (!file) return { ok: false, adapters: new Map(), error: { code: 'PORTAL_CONFIG_MISSING', reason: 'No submission adapter file configured' } };
  if (!fsImpl.existsSync(file)) return { ok: false, adapters: new Map(), error: { code: 'PORTAL_CONFIG_MISSING', reason: `Submission adapter file not found: ${file}` } };
  let raw;
  try { raw = JSON.parse(fsImpl.readFileSync(file, 'utf8')); } catch (error) {
    return { ok: false, adapters: new Map(), error: { code: 'PORTAL_CONFIG_INVALID', reason: `Not valid JSON: ${error.message}` } };
  }
  if (raw?.schema !== PORTAL_SCHEMA || !Array.isArray(raw.adapters)) {
    return { ok: false, adapters: new Map(), error: { code: 'PORTAL_CONFIG_INVALID', reason: `Expected schema ${PORTAL_SCHEMA} with an adapters array` } };
  }
  const adapters = new Map();
  for (const entry of raw.adapters) {
    const validated = validateAdapter(entry);
    if (!validated.ok) return { ok: false, adapters: new Map(), error: validated.error };
    adapters.set(validated.adapter.id, validated.adapter);
  }
  return { ok: true, adapters, error: null };
}

export function validateAdapter(entry = {}) {
  const fail = (code, reason) => ({ ok: false, error: { code, reason } });
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(String(entry.id || ''))) return fail('PORTAL_CONFIG_INVALID', 'adapter id must be lowercase');
  if (entry.type !== 'http-post') return fail('PORTAL_TYPE_UNSUPPORTED', `Unsupported adapter type ${entry.type}`);
  let url;
  try { url = new URL(entry.url); } catch { return fail('PORTAL_URL_INVALID', 'url is not a valid absolute URL'); }
  if (!['https:', 'http:'].includes(url.protocol)) return fail('PORTAL_URL_INVALID', 'url must be http(s)');
  if (url.protocol === 'http:' && !(LOOPBACK.has(url.hostname) && entry.allowInsecureLocalhost === true)) {
    return fail('PORTAL_INSECURE', 'plain HTTP requires allowInsecureLocalhost:true and a loopback host');
  }
  const allowedOrigins = Array.isArray(entry.allowedOrigins) ? entry.allowedOrigins.map(String) : [];
  if (!allowedOrigins.includes(url.origin)) {
    return fail('PORTAL_ORIGIN_NOT_ALLOWED', `allowedOrigins must include ${url.origin}`);
  }
  if (!entry.fieldMap || typeof entry.fieldMap !== 'object' || !Object.keys(entry.fieldMap).length) {
    return fail('PORTAL_FIELDS_MISSING', 'fieldMap is required');
  }
  if (typeof entry.cvField !== 'string' || !entry.cvField) return fail('PORTAL_CV_FIELD_MISSING', 'cvField is required');
  const ack = entry.ack || {};
  if (!Array.isArray(ack.bodyContainsAny) || !ack.bodyContainsAny.length) {
    return fail('PORTAL_ACK_RULE_MISSING', 'ack.bodyContainsAny is required; without it a submission can never be confirmed');
  }
  return {
    ok: true,
    adapter: {
      id: String(entry.id),
      type: 'http-post',
      url: url.toString(),
      origin: url.origin,
      allowInsecureLocalhost: entry.allowInsecureLocalhost === true,
      allowedOrigins,
      servesOrigin: Array.isArray(entry.servesOrigin) ? entry.servesOrigin.map(String) : null,
      fieldMap: { ...entry.fieldMap },
      cvField: String(entry.cvField),
      timeoutMs: Math.max(1000, Math.min(120000, Number(entry.timeoutMs) || 30000)),
      ack: {
        statusInList: Array.isArray(ack.statusInList) ? ack.statusInList.map(Number) : [200, 201, 202],
        bodyContainsAny: ack.bodyContainsAny.map(String),
        referenceRegex: typeof ack.referenceRegex === 'string' ? ack.referenceRegex : null,
      },
    },
  };
}

function template(value, context) {
  return String(value).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, key) => {
    const resolved = key.split('.').reduce((acc, part) => (acc == null ? acc : acc[part]), context);
    return resolved == null ? '' : String(resolved);
  });
}

export function buildFields(adapter, context) {
  const fields = {};
  for (const [name, templateValue] of Object.entries(adapter.fieldMap)) {
    const value = template(templateValue, context);
    if (value === '') throw new ArenaError(`Portal field ${name} resolved to an empty value`, 'PORTAL_FIELD_EMPTY');
    fields[name] = value;
  }
  return fields;
}

function evaluateAck(adapter, status, bodyText) {
  if (!adapter.ack.statusInList.includes(status)) return { acknowledged: false, reason: `HTTP ${status} is not an acknowledgement status` };
  const lowered = bodyText.toLowerCase();
  const hit = adapter.ack.bodyContainsAny.find((needle) => lowered.includes(String(needle).toLowerCase()));
  if (!hit) return { acknowledged: false, reason: 'Response did not contain an acknowledgement phrase' };
  let reference = null;
  if (adapter.ack.referenceRegex) {
    try {
      const match = new RegExp(adapter.ack.referenceRegex).exec(bodyText);
      if (match) reference = match[1] || match[0];
    } catch {
      return { acknowledged: false, reason: 'Configured referenceRegex is invalid' };
    }
  }
  return { acknowledged: true, reference, matchedPhrase: hit };
}

/**
 * Build the `job.submit` handler adapter.
 * Returns a handler compatible with buildHandlers({ submitAdapter }).
 */
export function createPortalSubmitAdapter({
  adapters, adapterId = null, hunter, evidenceDir, log = null, clock = Date.now, fetchImpl = globalThis.fetch,
} = {}) {
  if (!hunter) throw new ArenaError('Portal adapter needs the job hunter', 'PORTAL_HUNTER_MISSING');
  if (!adapters || !adapters.size) throw new ArenaError('No portal adapters are configured', 'PORTAL_CONFIG_MISSING');

  async function pickAdapter(application) {
    if (adapterId) {
      const explicit = adapters.get(adapterId);
      if (!explicit) throw new ArenaError(`Unknown adapter ${adapterId}`, 'PORTAL_ADAPTER_UNKNOWN');
      return explicit;
    }
    // Match by employer host when the listing carries an application URL.
    const applyUrl = application?.job?.apply?.url || null;
    if (!applyUrl) throw new ArenaError('Application has no employer URL to select an adapter', 'PORTAL_NO_APPLY_URL');
    let host;
    try { host = new URL(applyUrl).hostname.toLowerCase(); } catch { throw new ArenaError('Application URL is invalid', 'PORTAL_NO_APPLY_URL'); }
    for (const adapter of adapters.values()) {
      if (new URL(adapter.url).hostname.toLowerCase() === host) return adapter;
    }
    throw new ArenaError(`No owner adapter matches ${host}; refusing to submit`, 'PORTAL_ADAPTER_NOT_CONFIGURED');
  }

  return async function submit(ctx) {
    const applicationId = ctx.task?.payload?.applicationId;
    if (typeof applicationId !== 'string' || !applicationId) {
      return { ok: false, retryable: false, error: { code: 'APPLICATION_ID_REQUIRED' }, summary: 'job.submit needs payload.applicationId' };
    }
    const application = await hunter.store.get(applicationId);
    if (!application) return { ok: false, retryable: false, error: { code: 'APPLICATION_NOT_FOUND' }, summary: 'Application not found' };

    if (['SUBMITTED_UNCONFIRMED', 'EMAIL_VERIFICATION_PENDING', 'CONFIRMED_RECEIVED'].includes(application.state)) {
      return { ok: true, summary: `Already submitted (${application.state}); nothing was sent again`, receipt: application.evidence?.at(-1)?.receipt || null };
    }
    if (application.state === 'UNCERTAIN') {
      return { uncertain: { code: 'APPLICATION_UNCERTAIN', reason: 'A previous attempt has an unknown outcome; reconcile before submitting' } };
    }
    if (application.state === 'BLOCKED') {
      return { blocked: { code: 'APPLICATION_BLOCKED', reason: 'Application is blocked and needs an owner decision', requiresOwner: true } };
    }
    if (!['APPROVED', 'FORM_STARTED', 'FORM_PREPARED'].includes(application.state)) {
      return { ok: false, retryable: false, error: { code: 'APPLICATION_STATE_INVALID', reason: `Cannot submit from ${application.state}` }, summary: 'Not approved' };
    }

    const profileResult = hunter.profile(application.candidateId);
    if (!profileResult.ok) return { ok: false, retryable: false, error: profileResult.error, summary: profileResult.error.reason };
    const profile = profileResult.profile;

    let adapter;
    try { adapter = await pickAdapter(application); } catch (error) {
      return { blocked: { code: error.code || 'PORTAL_ADAPTER_NOT_CONFIGURED', reason: error.message, requiresOwner: true } };
    }

    const employerUrl = application.job?.apply?.url || application.job?.url || null;
    if (adapter.servesOrigin?.length) {
      let employerOrigin = null;
      try { employerOrigin = employerUrl ? new URL(employerUrl).origin : null; } catch { employerOrigin = null; }
      if (!employerOrigin || !adapter.servesOrigin.includes(employerOrigin)) {
        return {
          blocked: {
            code: 'PORTAL_EMPLOYER_ORIGIN_MISMATCH',
            reason: `Adapter ${adapter.id} is not declared to serve ${employerOrigin || 'this application'}; nothing was sent.`,
            requiresOwner: true,
          },
        };
      }
    }

    if (application.state === 'APPROVED') {
      // The state machine demands the employer's real https URL. The endpoint
      // actually contacted is kept in the receipt and the evidence file.
      const portalUrl = /^https:\/\//i.test(employerUrl || '') ? employerUrl : adapter.url;
      try {
        transitionApplication(application, 'FORM_STARTED', {
          by: 'v6-portal', now: clock,
          evidence: { portalUrl },
        });
      } catch (error) {
        return {
          blocked: {
            code: error.code || 'PORTAL_PORTAL_URL_INVALID',
            reason: `${error.message}. Nothing was sent.`,
            requiresOwner: true,
          },
        };
      }
      await hunter.store.save(application, { event: 'form-started' });
    }

    let cvBytes;
    try {
      const stat = fs.statSync(profile.cvPath);
      if (!stat.isFile() || stat.size === 0) throw new Error('CV file is empty');
      if (stat.size > 10 * 1024 * 1024) throw new Error('CV exceeds 10 MB');
      cvBytes = fs.readFileSync(profile.cvPath);
    } catch (error) {
      await hunter.store.save(application, { event: 'cv-unreadable' });
      return {
        blocked: {
          code: 'CV_UNREADABLE',
          reason: `The owner CV could not be read (${error.message}). Nothing was sent.`,
          requiresOwner: true,
        },
      };
    }
    const cvFileName = path.basename(profile.cvPath);

    let fields;
    try {
      fields = buildFields(adapter, {
        candidate: { displayName: profile.displayName, contactEmail: profile.contactEmail, id: profile.id },
        job: {
          title: application.job.title, company: application.job.company,
          siteId: application.job.siteId, city: application.job.city || '',
          url: application.job.url || '',
        },
        application: { id: application.id },
      });
    } catch (error) {
      return { blocked: { code: error.code || 'PORTAL_FIELD_EMPTY', reason: error.message, requiresOwner: true } };
    }

    if (application.state === 'FORM_STARTED') {
      try {
        transitionApplication(application, 'FORM_PREPARED', {
          by: 'v6-portal', now: clock,
          evidence: { fieldsVerified: true, cvFileName, fieldCount: Object.keys(fields).length },
        });
      } catch (error) {
        return { blocked: { code: error.code || 'PORTAL_PREPARE_INVALID', reason: `${error.message}. Nothing was sent.`, requiresOwner: true } };
      }
      await hunter.store.save(application, { event: 'form-prepared' });
    }

    await ctx.progress(`submitting to ${adapter.id}`);
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, value);
    form.append(adapter.cvField, new Blob([cvBytes], { type: 'application/pdf' }), cvFileName);

    let status = 0;
    let bodyText = '';
    let responseHeaders = {};
    try {
      const response = await fetchImpl(adapter.url, {
        method: 'POST',
        body: form,
        redirect: 'manual', // never follow a redirect that could carry the CV elsewhere
        signal: AbortSignal.timeout(adapter.timeoutMs),
      });
      status = response.status;
      responseHeaders = Object.fromEntries([...response.headers.entries()].filter(([key]) => ['content-type', 'location'].includes(key)));
      bodyText = (await response.text()).slice(0, 20000);
    } catch (error) {
      return { uncertain: { code: 'PORTAL_NETWORK_UNCERTAIN', reason: `Request failed after it may have been received: ${String(error.message || error).slice(0, 200)}` } };
    }

    fs.mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });
    const evidenceFile = path.join(evidenceDir, `${application.id}-${Date.now()}.json`);
    fs.writeFileSync(evidenceFile, `${JSON.stringify({
      schema: 'majin.v6.portal.evidence/v1',
      applicationId: application.id,
      adapterId: adapter.id,
      url: adapter.url,
      status,
      responseHeaders,
      bodySha256: (await import('node:crypto')).createHash('sha256').update(bodyText).digest('hex'),
      bodyPreview: bodyText.slice(0, 2000),
      at: new Date(clock()).toISOString(),
    }, null, 2)}\n`, { mode: 0o600 });

    const verdict = evaluateAck(adapter, status, bodyText);
    if (!verdict.acknowledged) {
      // The portal answered, but not with an acknowledgement. That is an
      // unknown outcome, not a failure we may blindly retry.
      return {
        uncertain: {
          code: 'PORTAL_ACK_NOT_OBSERVED',
          reason: `${verdict.reason} (HTTP ${status}); evidence saved locally, treat as unknown and reconcile`,
        },
      };
    }

    const recorded = await hunter.recordSubmission({
      applicationId: application.id,
      receipt: {
        kind: 'portal-ack',
        reference: verdict.reference || `http-${status}`,
        url: employerUrl || adapter.url,
        endpoint: adapter.url,
        evidencePath: evidenceFile,
        matchedPhrase: verdict.matchedPhrase,
      },
      portalUrl: employerUrl || adapter.url,
    });
    if (!recorded.ok) return { ok: false, retryable: false, error: recorded.error, summary: 'Acknowledgement received but the application could not be recorded' };

    log?.append('job.submitted', {
      taskId: ctx.task?.id || null, candidateId: application.candidateId, applicationId: application.id,
      adapterId: adapter.id, status,
    });
    return {
      ok: true,
      summary: `Submitted via ${adapter.id}; portal acknowledged${verdict.reference ? ` (${verdict.reference})` : ''}`,
      receipt: { kind: 'portal-ack', reference: verdict.reference || `http-${status}` },
      evidence: { adapterId: adapter.id, httpStatus: status, evidencePath: evidenceFile },
    };
  };
}
