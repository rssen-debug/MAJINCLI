/**
 * MAJIN V4 — HTTP + SSE server.
 *
 * Loopback by default. Authentication is a signed, server-side session cookie
 * issued by exchanging the host's pairing code; every mutating request also
 * needs the X-MAJIN-CSRF header and a same-origin Origin. Tool execution never
 * happens in a request handler — the agent owns it, behind approvals.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNodeSupported } from './config.js';
import {
  clearCookie,
  ensureDir,
  ensurePairing,
  loadSecret,
  parseCookies,
  pairingExists,
  SessionStore,
  sessionCookie,
  verifyPairing,
} from './auth.js';
import {
  clientKey,
  HttpError,
  RateLimiter,
  assertCsrfHeader,
  assertHostAllowed,
  assertOriginAllowed,
  readJsonBody,
} from './security.js';
import { ConversationStore, GoalStore, publicGoal } from './store.js';
import { createToolRegistry } from './tools.js';
import { createModelClient } from './model.js';
import { createAgent } from './agent.js';
import { discoverModels, refreshAllCatalogs } from './models.js';
import { Kernel } from './kernel.js';
import { t } from './ui/strings.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');

const STATIC = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/index.html': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/spirit.js': { file: 'spirit.js', type: 'text/javascript; charset=utf-8' },
  '/voice.js': { file: 'voice.js', type: 'text/javascript; charset=utf-8' },
  '/strings.js': { file: 'strings.js', type: 'text/javascript; charset=utf-8' },
  '/manifest.webmanifest': { file: 'manifest.webmanifest', type: 'application/manifest+json; charset=utf-8' },
  '/sw.js': { file: 'sw.js', type: 'text/javascript; charset=utf-8' },
  '/icons/icon-192.png': { file: 'icons/icon-192.png', type: 'image/png' },
  '/icons/icon-512.png': { file: 'icons/icon-512.png', type: 'image/png' },
  '/icons/maskable-512.png': { file: 'icons/maskable-512.png', type: 'image/png' },
};

function securityHeaders({ frameAncestors }) {
  const headers = {
    'content-security-policy': [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "font-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "media-src 'self' blob:",
      "base-uri 'none'",
      "form-action 'none'",
      `frame-ancestors ${frameAncestors}`,
    ].join('; '),
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'permissions-policy': 'microphone=(self), camera=(), geolocation=()',
    'cache-control': 'no-store',
  };
  if (frameAncestors === "'none'") headers['x-frame-options'] = 'DENY';
  return headers;
}

function sendJson(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders,
  });
  res.end(payload);
}

function fail(res, status, code, message, extraHeaders = {}) {
  sendJson(res, status, { ok: false, error: { code, message } }, extraHeaders);
}

function isSecureRequest(req, config) {
  if (req.socket?.encrypted) return true;
  if (config.trustProxy) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (proto === 'https') return true;
  }
  return Boolean(config.publicOrigin && config.publicOrigin.startsWith('https://'));
}

export function createV4Server({ config }) {
  assertNodeSupported();
  const paths = config.paths;
  ensureDir(paths.root);
  ensureDir(paths.conversations);
  ensureDir(paths.goals);
  ensureDir(paths.memory);
  const workspaceDir = path.join(paths.workspace);
  fs.mkdirSync(workspaceDir, { recursive: true, mode: 0o700 });

  const secret = loadSecret(paths.secret);
  const pairingFresh = ensurePairing(paths.pairing, secret);
  const sessions = new SessionStore({
    file: paths.serverState,
    secret,
    ttlMs: config.auth.sessionTtlMs,
  });

  const conversations = new ConversationStore({
    dir: paths.conversations,
    maxMessages: config.limits.maxStoredMessages,
  });
  const goals = new GoalStore({ dir: paths.goals });
  const reconciled = goals.reconcileOnBoot();

  const tools = createToolRegistry({ workspaceDir, memoryDir: paths.memory });
  const model = createModelClient(config, { workspaceDir });
  const agent = createAgent({ config, conversations, goals, tools, model });

  const kernel = new Kernel({
    features: config.platform?.features || {},
    pluginsEnabled: config.platform?.pluginsEnabled || false,
    allowlist: config.platform?.pluginAllowlist || [],
    isolate: config.platform?.pluginIsolate !== false,
    quarantineDir: config.platform?.pluginQuarantineDir || null,
  });
  // Plugin tools join the same registry the built-ins use, so they inherit
  // schema validation, approval policy and receipts. A plugin that cannot be
  // expressed as a ToolDefinition is reported as failed, never half-wired.
  const kernelReady = kernel.loadPlugins(config.platform?.pluginsDir || paths.plugins).then((results) => {
    for (const cap of kernel.list().filter((c) => c.kind === 'tool')) {
      const impl = kernel.get('tool', cap.name);
      if (!impl?.inputSchema || !impl?.outputSchema) continue;
      try {
        tools.registry.define({
          name: cap.name,
          description: impl.description || `plugin tool ${cap.name}`,
          tier: impl.tier || 'read',
          inputSchema: impl.inputSchema,
          outputSchema: impl.outputSchema,
          execute: impl.execute,
        });
      } catch { /* registry validation is the source of truth; failure is visible in /api/kernel */ }
    }
    return results;
  });

  // A turn named in a query string must belong to this process.
  const limiter = new RateLimiter({
    windowMs: config.limits.rate.windowMs,
    limits: {
      general: config.limits.rate.requests,
      turns: config.limits.rate.turns,
      pairing: config.limits.rate.pairing,
    },
  });

  function sessionFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[config.auth.cookieName];
    const session = sessions.verify(token);
    return { token, session };
  }

  function requireSession(req) {
    const { token, session } = sessionFromRequest(req);
    if (!session) throw new HttpError(401, 'UNAUTHORIZED', 'Pair this device first.');
    sessions.touch(session);
    return { token, session };
  }

  async function handlePair(req, res) {
    const key = clientKey(req, config);
    limiter.take('pairing', key);
    const body = await readJsonBody(req, 4096);
    const ok = verifyPairing(paths.pairing, secret, String(body.code || ''));
    if (!ok) throw new HttpError(401, 'PAIRING_REJECTED', 'That pairing code is not valid.');
    const { token, session } = sessions.create({ ip: key, userAgent: req.headers['user-agent'] });
    const secure = isSecureRequest(req, config);
    res.setHeader('set-cookie', sessionCookie(config.auth.cookieName, token, {
      secure,
      maxAgeSeconds: Math.floor(config.auth.sessionTtlMs / 1000),
    }));
    sendJson(res, 200, { ok: true, session: { id: `${session.id.slice(0, 6)}…`, expiresAt: new Date(session.expiresAt).toISOString() } });
  }

  function serveStatic(req, res, entry) {
    const file = path.join(UI_DIR, entry.file);
    let body;
    try {
      body = fs.readFileSync(file);
    } catch {
      fail(res, 404, 'NOT_FOUND', 'Asset not found.');
      return;
    }
    const headers = {
      'content-type': entry.type,
      'cache-control': entry.file === 'sw.js' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    };
    if (entry.file === 'sw.js') headers['service-worker-allowed'] = '/';
    res.writeHead(200, headers);
    res.end(body);
  }

  function startSse(res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    let closed = false;
    const heartbeat = setInterval(() => {
      if (!closed) res.write(': ping\n\n');
    }, 15_000);
    const send = (event, data) => {
      if (closed || res.writableEnded) return;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        closed = true;
      }
    };
    const close = () => {
      closed = true;
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    };
    res.on('close', () => {
      closed = true;
      clearInterval(heartbeat);
    });
    return { send, close };
  }

  async function handleChat(req, res, session) {
    const key = clientKey(req, config);
    limiter.take('turns', key);
    const body = await readJsonBody(req, config.limits.maxBodyBytes);
    const conversationId = body.conversationId ? String(body.conversationId) : null;
    const text = String(body.text ?? '');
    const requestId = body.requestId ? String(body.requestId).slice(0, 80) : null;
    if (!text.trim()) throw new HttpError(400, 'EMPTY_MESSAGE', 'Message is empty.');
    if (text.length > config.limits.maxMessageChars) {
      throw new HttpError(413, 'MESSAGE_TOO_LONG', 'Message is too long.');
    }

    const sse = startSse(res);
    const controller = agent.beginTurn(conversationId || 'new');
    sse.send('open', { at: new Date().toISOString(), model: agent.modelInfo });
    try {
      await agent.runTurn({
        conversationId,
        text,
        requestId,
        signal: controller.signal,
        emit: (type, data) => sse.send(type, data),
      });
    } catch (err) {
      sse.send('error', { message: err.message || 'turn failed' });
    } finally {
      agent.endTurn(conversationId || 'new', controller);
      sse.close();
    }
    void session;
  }

  const routes = {
    'GET /api/health': async (req, res) => {
      sendJson(res, 200, {
        ok: true,
        app: 'majin',
        version: config.version,
        ready: true,
        setupRequired: !pairingExists(paths.pairing),
        time: new Date().toISOString(),
      });
    },

    'GET /api/me': async (req, res) => {
      const { session } = sessionFromRequest(req);
      if (!session) {
        sendJson(res, 200, { ok: true, authenticated: false });
        return;
      }
      sendJson(res, 200, {
        ok: true,
        authenticated: true,
        session: { createdAt: new Date(session.createdAt).toISOString(), expiresAt: new Date(session.expiresAt).toISOString() },
      });
    },

    'POST /api/auth/pair': handlePair,

    'POST /api/auth/logout': async (req, res) => {
      const { token } = sessionFromRequest(req);
      if (token) sessions.revokeByToken(token);
      res.setHeader('set-cookie', clearCookie(config.auth.cookieName, { secure: isSecureRequest(req, config) }));
      sendJson(res, 200, { ok: true });
    },

    'GET /api/kernel': async (req, res) => {
      requireSession(req);
      await kernelReady;
      sendJson(res, 200, { ok: true, ...kernel.summary() });
    },

    'GET /api/models': async (req, res, url) => {
      requireSession(req);
      if (url.searchParams.get('refresh') === '1') {
        limiter.take('general', clientKey(req, config), 2);
        // Live discovery uses V1's catalog implementation; failures are
        // reported per provider and never break the listing.
        await refreshAllCatalogs({ home: paths.home, env: process.env });
      }
      const catalogue = discoverModels({ home: paths.home, env: process.env });
      sendJson(res, 200, {
        ok: true,
        ...catalogue,
        // A listed model is not proof of inference; the flag says so.
        caveat: t('model.caveat'),
      });
    },

    'POST /api/model': async (req, res) => {
      requireSession(req);
      assertCsrfHeader(req);
      const body = await readJsonBody(req, 4096);
      const modelId = body.modelId == null ? null : String(body.modelId);
      const conversationId = String(body.conversationId || '');
      if (modelId) {
        const catalogue = discoverModels({ home: paths.home, env: process.env });
        const known = catalogue.models.some((m) => m.id === modelId && m.configured);
        if (!known) throw new HttpError(400, 'MODEL_NOT_CONFIGURED', 'That model is not configured on the host.');
      }
      const result = agent.setConversationModel({ conversationId, modelId });
      sendJson(res, 200, { ok: true, ...result });
    },

    'GET /api/state': async (req, res) => {
      requireSession(req);
      const catalogue = discoverModels({ home: paths.home, env: process.env });
      sendJson(res, 200, {
        ok: true,
        version: config.version,
        model: agent.modelInfo,
        models: {
          count: catalogue.models.length,
          configured: catalogue.models.filter((m) => m.configured).length,
          verified: catalogue.liveVerifiedCount,
          source: catalogue.source,
          current: catalogue.current,
        },
        policy: config.approvals.policy,
        workspace: { label: 'arbetsyta', files: listWorkspace(tools.root) },
        conversations: conversations.list().slice(0, 30),
        goals: goals.list().slice(-10).reverse(),
        caps: { voice: true, voiceEngine: 'browser', streaming: true, tools: ['workspace_write', 'workspace_read', 'workspace_list', 'memory_save', 'memory_search'] },
      });
    },

    'POST /api/chat': async (req, res) => {
      const { session } = requireSession(req);
      assertCsrfHeader(req);
      await handleChat(req, res, session);
    },

    'POST /api/cancel': async (req, res) => {
      requireSession(req);
      assertCsrfHeader(req);
      const body = await readJsonBody(req, 4096);
      const cancelled = agent.cancel(String(body.conversationId || ''));
      sendJson(res, 200, { ok: true, cancelled });
    },

    'POST /api/goal/resume': async (req, res) => {
      requireSession(req);
      assertCsrfHeader(req);
      const body = await readJsonBody(req, 4096);
      const goalId = String(body.goalId || '');
      if (!goalId) throw new HttpError(400, 'GOAL_ID_REQUIRED', 'goalId is required.');
      const sse = startSse(res);
      try {
        const result = await agent.resumeGoal({ goalId, emit: (type, data) => sse.send(type, data) });
        sse.send('resume_result', { status: result.status, missing: result.missing || [], results: result.results });
      } catch (err) {
        sse.send('error', { message: err.message || 'resume failed', code: err.code || null });
      } finally {
        sse.close();
      }
    },

    'POST /api/approve': async (req, res) => {
      requireSession(req);
      assertCsrfHeader(req);
      const body = await readJsonBody(req, 4096);
      const conversationId = String(body.conversationId || '');
      const sse = startSse(res);
      try {
        await agent.resolveApproval({
          conversationId,
          approve: body.approve === true,
          emit: (type, data) => sse.send(type, data),
        });
      } catch (err) {
        sse.send('error', { message: err.message || 'approval failed' });
      } finally {
        sse.close();
      }
    },

    'GET /api/conversations': async (req, res) => {
      requireSession(req);
      sendJson(res, 200, { ok: true, conversations: conversations.list() });
    },

    'POST /api/conversations': async (req, res) => {
      requireSession(req);
      assertCsrfHeader(req);
      const conv = conversations.create();
      sendJson(res, 201, { ok: true, conversation: { id: conv.id, title: conv.title, modelId: conv.modelId || null } });
    },

    'DELETE /api/conversations': async (req, res, url) => {
      requireSession(req);
      assertCsrfHeader(req);
      const id = url.searchParams.get('id') || '';
      const removed = conversations.remove(id);
      sendJson(res, 200, { ok: true, removed });
    },

    'GET /api/conversation': async (req, res, url) => {
      requireSession(req);
      const conv = conversations.get(url.searchParams.get('id') || '');
      if (!conv) throw new HttpError(404, 'NOT_FOUND', 'Conversation not found.');
      sendJson(res, 200, {
        ok: true,
        conversation: {
          id: conv.id,
          title: conv.title,
          modelId: conv.modelId || null,
          version: conv.version,
          updatedAt: conv.updatedAt,
          messages: conv.messages,
          goals: goalsIn(conv),
          pendingApproval: conv.pendingApproval ? { tool: conv.pendingApproval.tool, scope: conv.pendingApproval.scope } : null,
        },
      });
    },

    'GET /api/goal': async (req, res, url) => {
      requireSession(req);
      const goal = goals.get(url.searchParams.get('id') || '');
      if (!goal) throw new HttpError(404, 'NOT_FOUND', 'Goal not found.');
      sendJson(res, 200, { ok: true, goal: publicGoal(goal) });
    },

    'GET /api/sessions': async (req, res) => {
      requireSession(req);
      sendJson(res, 200, { ok: true, sessions: sessions.list() });
    },
  };

  /** Goal ids referenced by a conversation's messages, with live state. */
  function goalsIn(conv) {
    const ids = [...new Set(conv.messages.map((m) => m.meta?.goalId).filter(Boolean))];
    return ids
      .map((id) => goals.get(id))
      .filter(Boolean)
      .map((g) => ({
        id: g.id,
        state: g.state,
        objective: g.objective,
        ...(g.revisionOf ? { revisionOf: g.revisionOf, revision: g.revision } : {}),
      }));
  }

  function listWorkspace(root) {
    try {
      return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).slice(0, 50).map((e) => e.name);
    } catch {
      return [];
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      const hostname = assertHostAllowed(req, config);
      assertOriginAllowed(req, config, hostname);
      res.setHeader('x-majin-version', config.version);
      for (const [k, v] of Object.entries(securityHeaders(config))) res.setHeader(k, v);

      if (req.method === 'GET' && STATIC[url.pathname]) {
        serveStatic(req, res, STATIC[url.pathname]);
        return;
      }

      const key = `${req.method} ${url.pathname}`;
      const route = routes[key];
      if (!route) {
        if (url.pathname.startsWith('/api/')) fail(res, 404, 'NOT_FOUND', 'Unknown API route.');
        else fail(res, 404, 'NOT_FOUND', 'Not found.');
        return;
      }

      if (req.method !== 'GET') limiter.take('general', clientKey(req, config));
      await route(req, res, url);
    } catch (err) {
      if (res.headersSent) {
        try {
          res.end();
        } catch { /* already gone */ }
        return;
      }
      if (err instanceof HttpError) {
        const headers = err.meta?.retryAfter ? { 'retry-after': String(err.meta.retryAfter) } : {};
        if (err.status === 401) headers['www-authenticate'] = 'Pairing';
        fail(res, err.status, err.code, err.message, headers);
        return;
      }
      fail(res, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
    }
  });

  // Workers are killed when the listener closes, so a stopped host leaves no
  // orphaned plugin processes behind.
  server.on('close', () => kernel.shutdownWorkers());

  return {
    server,
    context: { config, sessions, conversations, goals, tools, model, agent, kernel, kernelReady, reconciled, pairingFresh },
  };
}

export async function startV4Server({ config }) {
  const { server, context } = createV4Server({ config });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  const address = server.address();
  const url = `http://${config.host.includes(':') ? `[${config.host}]` : config.host}:${address.port}`;
  return { server, context, url, port: address.port };
}
