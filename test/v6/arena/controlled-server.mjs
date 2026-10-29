/**
 * Controlled end-to-end stack: a real HTTP relay, a real application endpoint
 * and a real Gmail-shaped read-only API, all on loopback.
 *
 * This is NOT an employer and NOT Gmail. It exists so the full chain (signed
 * envelope -> relay -> queue -> worker -> HTTP submission -> acknowledgement ->
 * email confirmation) runs over real sockets with real signatures, instead of
 * being mocked at the function boundary. Any result from it proves the
 * machinery, never that a real application was received by a company.
 */
import http from 'node:http';
import { createHash } from 'node:crypto';

export const RELAY_TOKEN = 'relay-token-for-controlled-e2e-0123456789';
export const GMAIL_ACCESS_TOKEN = 'controlled-gmail-access-token';

export const DEFAULT_JOBS = [
  {
    site: 'platsbanken', siteId: '9001', title: 'Frontend Developer', company: 'Acme AB',
    city: 'Stockholm', url: 'https://acme.example/jobs/9001',
    apply: { url: 'https://acme.example/jobs/9001/apply' },
    mustHave: ['JavaScript', 'React'], niceToHave: ['TypeScript'],
    description: 'React and Node.js frontend role.',
  },
  {
    site: 'platsbanken', siteId: '9002', title: 'Frontend Developer', company: 'Atea AB',
    city: 'Stockholm', url: 'https://atea.example/jobs/9002',
    apply: { url: 'https://atea.example/jobs/9002/apply' },
    mustHave: ['JavaScript'], description: 'Excluded employer for this candidate.',
  },
];

export async function startControlledStack({
  jobs = DEFAULT_JOBS,
  ackStatus = 200,
  applyHang = false,
  ackText = 'Thank you for your application. Your application has been received. Reference: ACME-2026-0042',
  confirmationSubject = 'Thank you for your application',
  confirmationBody = 'We have received your application for Frontend Developer. Reference: ACME-2026-0042',
  confirmationKind = 'confirmation',
} = {}) {
  const stats = {
    submissions: 0,
    submissionBodies: [],
    outbox: new Map(),
    acks: [],
    gmailSearches: 0,
    tokenRequests: 0,
    hungRequests: 0,
  };

  const readBody = (request) => new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });

  const send = (response, status, value) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(`${JSON.stringify(value)}\n`);
  };
  const sendText = (response, status, text) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(text);
  };

  const authorized = (request) => request.headers.authorization === `Bearer ${RELAY_TOKEN}`;

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${server.address().port}`);
    const pathname = url.pathname;

    // ----- relay -----
    if (pathname.startsWith('/relay/')) {
      if (!authorized(request)) return send(response, 401, { error: 'unauthorized' });
      if (request.method === 'GET' && pathname === '/relay/inbox') {
        return send(response, 200, { items: [...inbox.keys()].map((id) => ({ id })) });
      }
      const inboxMatch = /^\/relay\/inbox\/([^/]+)$/.exec(pathname);
      if (inboxMatch) {
        const id = decodeURIComponent(inboxMatch[1]);
        if (request.method === 'PUT') {
          const body = JSON.parse((await readBody(request)).toString('utf8'));
          inbox.set(id, body);
          return send(response, 201, { ok: true });
        }
        if (request.method === 'GET') {
          if (!inbox.has(id)) return send(response, 404, { error: 'missing' });
          return send(response, 200, inbox.get(id));
        }
      }
      const ackMatch = /^\/relay\/ack\/([^/]+)$/.exec(pathname);
      if (ackMatch && request.method === 'POST') {
        const id = decodeURIComponent(ackMatch[1]);
        inbox.delete(id);
        stats.acks.push({ id, body: JSON.parse((await readBody(request)).toString('utf8') || '{}') });
        return send(response, 200, { ok: true });
      }
      const outboxMatch = /^\/relay\/outbox\/([^/]+)$/.exec(pathname);
      if (outboxMatch) {
        const id = decodeURIComponent(outboxMatch[1]);
        if (request.method === 'PUT') {
          const body = JSON.parse((await readBody(request)).toString('utf8'));
          stats.outbox.set(id, body);
          return send(response, 201, { ok: true });
        }
        if (request.method === 'GET') {
          if (!stats.outbox.has(id)) return send(response, 404, { error: 'missing' });
          return send(response, 200, stats.outbox.get(id));
        }
      }
      return send(response, 404, { error: 'relay route' });
    }

    // ----- job feed -----
    if (pathname === '/feed' && request.method === 'GET') {
      return send(response, 200, { ok: true, total: jobs.length, jobs });
    }

    // ----- application endpoint -----
    if (pathname === '/apply' && request.method === 'POST') {
      const raw = await readBody(request);
      const text = raw.toString('latin1');
      stats.submissions += 1;
      const hasCv = /name="cv";\s*filename="[^"]+"/.test(text);
      const hasName = /name="name"/.test(text);
      const hasEmail = /name="email"/.test(text);
      stats.submissionBodies.push({ hasCv, hasName, hasEmail, bytes: raw.length, sha256: createHash('sha256').update(raw).digest('hex') });
      if (!hasCv || !hasName || !hasEmail) {
        return sendText(response, 400, 'Missing required fields');
      }
      if (applyHang) {
        // Accept the request, never answer: the worker stalls mid-submission so
        // a crash test can kill it at the worst possible moment.
        stats.hungRequests = (stats.hungRequests || 0) + 1;
        return undefined;
      }
      return sendText(response, ackStatus, ackText);
    }

    // ----- gmail-shaped read-only API -----
    if (pathname === '/token' && request.method === 'POST') {
      stats.tokenRequests += 1;
      return send(response, 200, { access_token: GMAIL_ACCESS_TOKEN, expires_in: 3600, token_type: 'Bearer' });
    }
    if (pathname === '/gmail/v1/users/me/messages' && request.method === 'GET') {
      stats.gmailSearches += 1;
      if (request.headers.authorization !== `Bearer ${GMAIL_ACCESS_TOKEN}`) return send(response, 401, { error: 'unauthorized' });
      return send(response, 200, { messages: [{ id: 'msg-e2e-1' }] });
    }
    if (pathname === '/gmail/v1/users/me/messages/msg-e2e-1' && request.method === 'GET') {
      if (request.headers.authorization !== `Bearer ${GMAIL_ACCESS_TOKEN}`) return send(response, 401, { error: 'unauthorized' });
      const body = Buffer.from(confirmationKind === 'confirmation' ? confirmationBody : confirmationBody, 'utf8')
        .toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
      return send(response, 200, {
        id: 'msg-e2e-1', threadId: 'thr-1', internalDate: String(Date.now()),
        snippet: confirmationBody.slice(0, 80), labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'Subject', value: confirmationSubject },
            { name: 'From', value: 'Acme Careers <careers@acme.example>' },
            { name: 'Date', value: new Date().toUTCString() },
          ],
          mimeType: 'text/plain', body: { data: body },
        },
      });
    }

    return send(response, 404, { error: 'not found' });
  });

  const inbox = new Map();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    stats,
    inbox,
    async close() {
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}
