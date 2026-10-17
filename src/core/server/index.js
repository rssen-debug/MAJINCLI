/**
 * MAJIN — server.
 * Bara node:http. Inget ramverk. Samma port serverar UI:et, API:t, SSE-flödet
 * och WhatsApp-webhooken. Token låser dörren; webbläsarfönstret får den automatiskt.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bus } from '../log.js';
import { dirs, safeJoin } from '../paths.js';
import { readHistory } from '../context.js';

const SELF_DIR = (() => {
  try {
    if (typeof __dirname !== 'undefined') return __dirname;
  } catch {
    /* bundlad CJS */
  }
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const UI_CANDIDATES = [path.resolve(SELF_DIR, 'ui'), path.resolve(SELF_DIR, '../../ui'), path.join(path.dirname(process.execPath), 'ui'), path.resolve(process.cwd(), 'src/ui')];
const UI_DIR = UI_CANDIDATES.find((d) => fs.existsSync(path.join(d, 'index.html'))) || UI_CANDIDATES[0];
const MAX_BODY = 64 * 1024 * 1024;
import { VERSION } from '../version.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.jsonl': 'application/x-ndjson; charset=utf-8',
  '.yar': 'text/plain; charset=utf-8',
};

export function createServer(rt) {
  const { cfg, agent, registry, memory, skills, usage, approvals, scheduler, channels, dataset } = rt;
  const pairs = new Map();

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      bus.error('http.error', { url: req.url, error: err.message });
      if (!res.headersSent) json(res, 500, { ok: false, error: err.message, hint: err.hint || null });
      else res.end();
    });
  });

  /** SPA-djuplänk: /panel, /session/xyz … ger index.html, okända filer ger 404. */
  const wantsIndex = (pp) => pp === '/' || pp === '/index.html' || pp === '/app'
    || (!pp.startsWith('/api/') && !path.extname(pp) && !fs.existsSync(path.join(UI_DIR, pp.replace(/\.\./g, ''))));

  async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    const token = String(cfg.get('server.token') || '');
    const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
    const authed = authOk(req, url, token, cfg, peer);

    res.setHeader('x-powered-by', 'MAJIN');
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type,authorization', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' });
      return res.end();
    }

    /* ---------- publika ---------- */
    if (p === '/healthz') return json(res, 200, { ok: true, name: cfg.get('name'), version: VERSION, up: Math.round(process.uptime()) });
    if (p === '/api/hello') return json(res, 200, { ok: true, name: cfg.get('name'), version: VERSION, needToken: !authed, tokenOk: authed });

    /* WhatsApp Cloud-webhook (Meta verifierar med eget token, ingen MAJIN-token) */
    if (p === '/whatsapp' || p === '/api/webhook/whatsapp') {
      if (!channels) return json(res, 503, { ok: false, error: 'channels are not running' });
      if (req.method === 'GET') {
        const q = Object.fromEntries(url.searchParams);
        const v = channels.whatsapp.verifyWebhook(q);
        if (!v.ok) return text(res, 403, v.error || 'avvisad');
        return text(res, 200, String(v.challenge || ''));
      }
      const raw = (await readBody(req, 2 * 1024 * 1024)).toString('utf8');
      const secret = cfg.get('channels.whatsapp.cloud.appSecret');
      if (secret) {
        const sig = String(req.headers['x-hub-signature-256'] || '');
        const crypto = await import('node:crypto');
        const want = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
        if (!sig || sig !== want) return text(res, 403, 'bad signature');
      }
      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return json(res, 400, { ok: false, error: 'the request body is not valid JSON' });
      }
      const r = channels.whatsapp.ingest(body);
      return json(res, 200, r.ok !== false ? { ok: true } : { ok: false });
    }

    if (p === '/api/keys/claim') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      const hit = pairs.get(code);
      if (!hit || hit.expires < Date.now()) return json(res, 404, { ok: false, error: 'the code is invalid or expired' });
      pairs.delete(code);
      return json(res, 200, { ok: true, token });
    }

    if (!authed) {
      if (p === '/' || p === '/index.html') {
        return html(res, 200, `<!doctype html><meta charset=utf-8><title>MAJIN — key required</title>
<style>body{background:#04070a;color:#9fe8ff;font:15px/1.6 ui-monospace,Menlo,Consolas,monospace;display:grid;place-items:center;height:100vh;margin:0}
a{color:#fff}b{color:#fff}pre{background:#0a1420;padding:10px 14px;border:1px solid #14384d;border-radius:8px;color:#c9f5ff}</style>
<div><b>MAJIN</b> needs the one-time key.<br>Run <pre>majin window</pre> to open a window with the key baked in.<br>Or open <pre>http://${req.headers.host}/?t=${token}</pre> just this once.</div>`);
      }
      return json(res, 401, { ok: false, error: 'token required', hint: `open with ?t=${token} or send the header \"authorization: Bearer ${token}\"` });
    }

    /* ---------- UI + statiska ---------- */
    if (wantsIndex(p)) {
      const file = path.join(UI_DIR, 'index.html');
      if (!fs.existsSync(file)) return html(res, 200, '<pre>UI missing — run: npm run ui</pre>');
      const raw = fs.readFileSync(file, 'utf8').replace(/__MAJIN_TOKEN__/g, token).replace(/__MAJIN_VERSION__/g, VERSION).replace(/__MAJIN___/g, cfg.get('name') || 'MAJIN');
      res.setHeader('set-cookie', `majin=${token}; Path=/; SameSite=Lax`);
      return html(res, 200, raw);
    }
    if (!p.startsWith('/api/')) {
      const clean = p.replace(/\.\./g, '');
      const file = path.join(UI_DIR, clean);
      if (file.startsWith(UI_DIR) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
        return fs.createReadStream(file).pipe(res);
      }
      return json(res, 404, { ok: false, error: `not found: ${p}` });
    }

    /* ---------- state ---------- */
    if (p === '/api/state') return json(res, 200, rt.state({ includeTools: url.searchParams.get('tools') !== '0' }));
    if (p === '/api/update' && req.method === 'GET') {
      return json(res, 200, { ok: true, version: VERSION, update: rt.update.info, current: VERSION });
    }
    if (p === '/api/update' && req.method === 'POST') {
      const body = await readJson(req);
      const action = ['download', 'install'].includes(body.action) ? body.action : 'check';
      if (action === 'install') {
        const r = await rt.update.install({ dir: body.dir || undefined, url: body.url || undefined });
        if (r.ok) setTimeout(() => rt.shutdown('update'), 1200);
        return json(res, r.ok ? 200 : 502, { ok: r.ok, action, ...r, restarting: Boolean(r.ok) });
      }
      if (action === 'download') {
        const r = await rt.update.download({ dir: body.dir || undefined, url: body.url || undefined });
        return json(res, r.ok ? 200 : 502, { ok: r.ok, action, ...r });
      }
      const info = await rt.update.check({ force: body.force !== false });
      return json(res, 200, { ok: !info.error, action, update: info, error: info.error || null });
    }
    if (p === '/api/config' && req.method === 'GET') return json(res, 200, { ok: true, config: cfg.redacted(), file: cfg.file, diffReady: true });
    if (p === '/api/logs') return json(res, 200, { ok: true, events: bus.tail(Number(url.searchParams.get('n') || 200), Number(url.searchParams.get('after') || 0)) });
    if (p === '/api/usage') return json(res, 200, { ok: true, ...usage.summary(), routes: cfg.routeTable().length });
    if (p === '/api/memory') {
      const q = url.searchParams.get('q');
      return json(res, 200, { ok: true, facts: q ? memory.recall(q, 20) : memory.facts(), events: memory.recentEvents(25), stats: memory.stats() });
    }
    if (p === '/api/skills') return json(res, 200, { ok: true, skills: skills.list() });
    if (p === '/api/dataset' && req.method !== 'POST') return json(res, 200, { ok: true, capture: dataset.on, share: 'no upload path exists', ...dataset.stats() });
    if (p === '/api/tools') return json(res, 200, { ok: true, count: registry.list().length, groups: registry.groups(), tools: registry.list().map((t) => ({ name: t.name, group: t.group, risk: t.risk, desc: t.desc, params: Object.keys(t.raw || {}) })) });
    if (p === '/api/schedule') return json(res, 200, { ok: true, jobs: scheduler ? scheduler.list() : [], enabled: Boolean(scheduler) });
    if (p === '/api/channels') return json(res, 200, { ok: true, ...(channels ? channels.status() : { telegram: { online: false, state: 'off' }, whatsapp: { online: false, state: 'off' } }) });
    if (p === '/api/approvals') return json(res, 200, { ok: true, pending: approvals.list(), recent: approvals.recent(12) });
    if (p === '/api/sessions') {
      let files = [];
      try {
        files = fs.readdirSync(dirs.sessions).filter((f) => f.endsWith('.jsonl'));
      } catch {
        /* ingen historik ännu */
      }
      const sessions = files
        .map((f) => {
          const abs = path.join(dirs.sessions, f);
          const st = fs.statSync(abs);
          const msgs = readHistory(path.basename(f, '.jsonl'), 3);
          const last = msgs[msgs.length - 1];
          return { id: path.basename(f, '.jsonl'), file: f, bytes: st.size, mtime: st.mtime.toISOString(), messages: msgs.length ? countLines(abs) : 0, lastRole: last?.role || null, lastAt: last?.ts || null, lastText: String(last?.content || '').slice(0, 120) };
        })
        .sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
      return json(res, 200, { ok: true, sessions, dir: dirs.sessions });
    }
    if (p === '/api/session/clear' && req.method === 'POST') {
      const body = await readJson(req);
      const id = String(body.session || 'desktop').replace(/[^\w.:-]/g, '_');
      const abs = path.join(dirs.sessions, `${id}.jsonl`);
      try {
        if (fs.existsSync(abs)) fs.renameSync(abs, `${abs}.${Date.now()}.bak`);
        return json(res, 200, { ok: true, session: id });
      } catch (err) {
        return json(res, 422, { ok: false, error: err.message });
      }
    }
    if (p === '/api/history') {
      const s = url.searchParams.get('session') || 'desktop';
      return json(res, 200, { ok: true, session: s, messages: readHistory(s, Number(url.searchParams.get('n') || 200)) });
    }
    if (p === '/api/keys/pair' && req.method === 'POST') {
      const code = Math.random().toString(36).slice(2, 8).toUpperCase();
      pairs.set(code, { code, expires: Date.now() + 5 * 60_000 });
      return json(res, 200, { ok: true, code, expiresSec: 300, url: `http://${req.headers.host}/?t=${token}` });
    }
    if (p === '/api/report' && req.method === 'GET') {
      const file = url.searchParams.get('file') || '';
      const abs = safeJoin(dirs.out, file);
      if (!abs || !fs.existsSync(abs)) return json(res, 404, { ok: false, error: 'the report does not exist' });
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${path.basename(abs)}"` });
      return fs.createReadStream(abs).pipe(res);
    }
    if (p === '/api/file') {
      const want = url.searchParams.get('path') || '';
      const abs = path.isAbsolute(want) ? path.resolve(want) : path.resolve(cfg.get('workspace'), want);
      const roots = [dirs.workspace, dirs.out, dirs.uploads, dirs.cache, dirs.memory, dirs.sessions, dirs.rules];
      const allowed = roots.some((root) => abs.startsWith(path.resolve(root) + path.sep) || abs === path.resolve(root));
      if (!allowed || !fs.existsSync(abs)) return json(res, 403, { ok: false, error: 'path not allowed', hint: 'the server only serves workspace, out, uploads and memory' });
      const st = fs.statSync(abs);
      res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'content-disposition': `attachment; filename="${path.basename(abs)}"` });
      return fs.createReadStream(abs).pipe(res);
    }

    /* ---------- SSE-flöden ---------- */
    if (p === '/api/events') {
      sseHead(res);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      (async () => {
        try {
          for await (const ev of bus.stream({ fromSeq: bus.seq, signal: ac.signal })) {
            if (res.writableEnded || res.destroyed) break;
            res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
          }
        } catch {
          /* klienten stängde */
        }
        res.end();
      })();
      return;
    }
    if (p === '/api/chat') {
      const body = await readJson(req);
      const last = Array.isArray(body.messages) ? body.messages.filter((m) => m && m.role === 'user').slice(-1)[0] : null;
      const input = String(body.input || body.text || body.prompt || body.content || (last && last.content) || '').trim();
      if (!input) return json(res, 400, { ok: false, error: 'empty input', hint: 'send {input:"…"} (or messages:[{role:"user",content:"…"}])' });
      const session = String(body.session || 'desktop');
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const noStream = body.stream === false || body.stream === 'false'
        || ['false', '0'].includes(String(url.searchParams.get('stream') || '').toLowerCase());
      if (noStream) {
        const r = await agent.turn({ input, session, attachments, source: 'api' });
        return json(res, 200, { ok: !r.error, ...r });
      }
      sseHead(res);
      const ac = new AbortController();
      res.on('close', () => ac.abort());
      try {
        const r = await agent.turn({
          input,
          session,
          attachments,
          source: 'ui',
          onEvent: (ev) => res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`),
        });
        res.write(`event: done\ndata: ${JSON.stringify({ ok: !r.error, steps: r.steps, tools: r.tools?.length || 0, usage: r.usage, moa: r.moa, job: r.job })}\n\n`);
      } catch (err) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: err.message, hint: err.hint || null })}\n\n`);
      }
      return res.end();
    }

    /* ---------- skrivningar ---------- */
    if (p === '/api/chat/stop' && req.method === 'POST') {
      const body = await readJson(req);
      agent.stop(String(body.session || 'desktop'));
      return json(res, 200, { ok: true });
    }
    if (p === '/api/config' && (req.method === 'PATCH' || req.method === 'POST')) {
      const patch = await readJson(req);
      if (!Object.keys(patch || {}).length) return json(res, 400, { ok: false, error: 'empty patch — send JSON' });
      const r = cfg.patch(patch, { source: 'ui' });
      return json(res, r.ok ? 200 : 422, { ok: r.ok, diff: r.diff || [], errors: r.errors || [], config: cfg.redacted() });
    }
    if (p === '/api/config/dry' && req.method === 'POST') {
      const patch = await readJson(req);
      const r = cfg.patch(patch, { dry: true });
      return json(res, 200, { ok: r.ok, diff: r.diff, errors: r.errors, preview: r.preview && { moa: r.preview.moa?.policy, routes: r.preview.models?.routes } });
    }
    if (p === '/api/intent' && req.method === 'POST') {
      const { parseIntent } = await import('../routes.js');
      const body = await readJson(req);
      const i = parseIntent(String(body.text || ''), cfg);
      const dry = i.matched ? cfg.patch(i.patch, { dry: true }) : { ok: false, errors: [], diff: [] };
      return json(res, 200, { ok: i.matched, matched: i.matched, notes: i.notes, patch: i.patch, diff: dry.diff, errors: dry.errors });
    }
    if (p === '/api/provider' && req.method === 'POST') {
      const body = await readJson(req);
      /* list | models | delete går genom samma verktyg som agenten har, så att
         UI och agent aldrig kan få olika uppfattning om vad en provider är. */
      if (body.action && body.action !== 'add' && body.action !== 'save') {
        const out = await registry.exec('majin.provider', { action: body.action, ...((body.name || body.preset) ? { name: body.name || body.preset } : {}), ...(body.preset ? { preset: body.preset } : {}), ...(body.baseUrl ? { baseUrl: body.baseUrl } : {}), ...(body.apiKey ? { apiKey: body.apiKey } : {}), ...(body.env ? { env: body.env } : {}), ...(body.models ? { models: Array.isArray(body.models) ? body.models.join(',') : body.models } : {}), ...(body.kind ? { kind: body.kind } : {}) }, { ...rt.ctx, session: 'ui-provider', step: 1 });
        if (out.ok === false) return json(res, 422, { ok: false, error: out.error?.message || 'provider action failed', hint: out.error?.hint || null });
        return json(res, 200, { ok: true, action: body.action, result: out.result, meta: out.meta || null, providers: cfg.providerStatus() });
      }
      const { PRESETS, needsKeyFor } = await import('../presets.js');
      const preset = PRESETS[body.preset];
      const name = String(body.name || (preset ? body.preset : 'custom')).replace(/[^a-z0-9_-]/gi, '').toLowerCase().slice(0, 24);
      if (!name) return json(res, 400, { ok: false, error: 'the provider-specific name is missing' });
      const entry = {
        label: body.label || preset?.label || name,
        kind: body.kind || preset?.kind || 'openai',
        baseUrl: body.baseUrl || preset?.baseUrl || '',
        apiKey: body.apiKey || '',
        models: Array.isArray(body.models) && body.models.length ? body.models : preset?.models || [],
      };
      if (!entry.baseUrl && entry.kind !== 'mock') return json(res, 422, { ok: false, error: 'baseUrl is required for a custom provider' });
      /* ett tomt nyckelfalt ar inte "spara" — en vanlig manniska trycker pa
         spara for att det ska vara klart, sa losen ska vara en mening */
      if (needsKeyFor(entry, preset)) {
        return json(res, 422, {
          ok: false,
          error: `no key pasted — ${entry.label} needs one`,
          hint: `${preset?.keyUrl ? `Get a key at ${preset.keyUrl}, copy the whole line, and paste it in the box. ` : 'Paste the key from the provider page into the box. '}Nothing was changed — the old setup still works.`,
          needsKey: true,
        });
      }
      const r = cfg.patch({ providers: { [name]: entry } }, { source: 'ui' });
      if (!r.ok) return json(res, 422, { ok: false, errors: r.errors });
      return json(res, 200, { ok: true, provider: name, status: cfg.providerStatus().find((p2) => p2.name === name) });
    }
    if (p === '/api/provider/test' && req.method === 'POST') {
      const body = await readJson(req);
      /* "testa provider X" utan modellnamn måste välja någon — annars skickas "x/" och
         gatewayen svarar 400 okänd modell, vilket ser ut som att MAJIN är trasigt */
      const want = String(body.ref || '').trim();
      const named = String(body.provider || cfg.get('models.provider') || '');
      const ref = want.includes('/') ? want : want || `${named}/${(cfg.get(`providers.${named}.models`) || [])[0] || 'default'}`;
      const { complete } = await import('../provider/chat.js');
      const route = cfg.resolveModel(ref, 'router');
      const t0 = Date.now();
      try {
        const r = await complete({ route, job: 'test', messages: [{ role: 'user', content: 'Answer with exactly: OK' }], maxTokens: 16, temperature: 0, retries: 0 });
        return json(res, 200, { ok: true, ms: Date.now() - t0, text: String(r.text).slice(0, 60), usage: r.usage });
      } catch (err) {
        const info = err.majin || (await import('../provider/chat.js')).explainError(err, route);
        return json(res, 200, {
          ok: false, error: info.human || err.message, code: err.code || null, kind: info.kind,
          hint: err.hint || null, ms: Date.now() - t0,
        });
      }
    }
    if (p === '/api/models' && req.method === 'GET') {
      const { listModelsUrl } = await import('../presets.js');
      const name = String(url.searchParams.get('provider') || cfg.get('models.provider'));
      const prov = (cfg.get('providers') || {})[name];
      if (!prov) return json(res, 404, { ok: false, error: `unknown provider "${name}"` });
      const listUrl = listModelsUrl(prov);
      if (!listUrl) return json(res, 200, { ok: true, provider: name, models: prov.models || [], note: 'the provider has no model list — type the model name yourself' });
      try {
        const r = await fetch(listUrl, { headers: prov.apiKey ? { authorization: `Bearer ${prov.apiKey}` } : {}, signal: AbortSignal.timeout(12000) });
        const j = await r.json().catch(() => ({}));
        const models = (j.data || j.models || j || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean).sort();
        return json(res, 200, { ok: r.ok, provider: name, models: models.slice(0, 400), count: models.length, status: r.status });
      } catch (err) {
        return json(res, 200, { ok: false, error: err.message, hint: 'network error or a wrong baseUrl' });
      }
    }
    if (p === '/api/approve' && req.method === 'POST') {
      const body = await readJson(req);
      const ok = approvals.respond(String(body.id), Boolean(body.approved), String(body.note || 'ui'));
      return json(res, 200, { ok, pending: approvals.list().length });
    }
    if (p === '/api/schedule' && req.method === 'POST') {
      if (!scheduler) return json(res, 503, { ok: false, error: 'the scheduler is off' });
      const body = await readJson(req);
      try {
        return json(res, 200, { ok: true, job: scheduler.add({ when: body.when, task: body.task, deliver: body.deliver || 'silent', model: body.model || null, name: body.name || '' }) });
      } catch (err) {
        return json(res, 422, { ok: false, error: err.message });
      }
    }
    if (p === '/api/schedule' && req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      return json(res, 200, { ok: scheduler ? scheduler.remove(id) : false });
    }
    if (p === '/api/schedule/run' && req.method === 'POST') {
      const body = await readJson(req);
      const r = scheduler ? await scheduler.runNow(body.id) : { error: 'ingen scheduler' };
      return json(res, r.error ? 422 : 200, { ok: !r.error, ...r });
    }
    if (p === '/api/skills' && req.method === 'POST') {
      const body = await readJson(req);
      const r = skills.save(body);
      return json(res, r.ok ? 200 : 422, r);
    }
    if (p === '/api/memory' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'forget') return json(res, 200, { ok: memory.forget(String(body.query || '')) });
      return json(res, 200, memory.remember(String(body.text || ''), body.tags || []));
    }
    if (p === '/api/channels/telegram' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.botToken) cfg.patch({ channels: { telegram: { botToken: String(body.botToken).trim(), enabled: true } } });
      if (!channels) return json(res, 503, { ok: false, error: 'channels are not running (restart MAJIN with channels enabled)' });
      const ok = body.action === 'stop' ? channels.stopTelegram() : await channels.startTelegram();
      return json(res, 200, { ok: Boolean(ok), status: channels.telegram.status(), pairingCode: channels.telegram.status().pairingCode });
    }
    if (p === '/api/channels/whatsapp' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.transport) cfg.patch({ channels: { whatsapp: { transport: body.transport === 'cloud' ? 'cloud' : 'baileys', enabled: true, ...(body.cloud || {}) } } });
      if (!channels) return json(res, 503, { ok: false, error: 'channels are not running' });
      if (body.action === 'stop') await channels.stopWhatsapp();
      else await channels.startWhatsapp();
      return json(res, 200, { ok: true, status: channels.whatsapp.status() });
    }
    if (p === '/api/channels/allow' && req.method === 'POST') {
      const body = await readJson(req);
      if (body.channel === 'telegram') {
        const list = [...new Set([...(cfg.get('channels.telegram.allowedChatIds') || []), Number(body.chatId)])].filter(Boolean);
        cfg.patch({ channels: { telegram: { allowedChatIds: list } } });
        return json(res, 200, { ok: true, list });
      }
      if (channels) await channels.whatsapp.allow(body.jid);
      return json(res, 200, { ok: true, list: cfg.get('channels.whatsapp.allowedJids') || [] });
    }
    if (p === '/api/re/upload' && req.method === 'POST') {
      const name = sanitize(String(url.searchParams.get('name') || 'prov.bin'));
      const cap = cfg.get('tools.re.maxFileBytes') || 6e8;
      const buf = await readBody(req, cap);
      if (buf.length > cap) return json(res, 413, { ok: false, error: `file too large (${buf.length} > ${cap})` });
      const abs = path.join(dirs.uploads, `${Date.now()}-${name}`);
      fs.mkdirSync(dirs.uploads, { recursive: true });
      fs.writeFileSync(abs, buf);
      const crypto = await import('node:crypto');
      const sha = crypto.createHash('sha256').update(buf).digest('hex');
      return json(res, 200, { ok: true, path: abs, name, size: buf.length, sha256: sha });
    }
    if (p === '/api/re/analyze' && req.method === 'POST') {
      const body = await readJson(req);
      const out = await registry.exec('re.analyze', { path: String(body.path || ''), maxStrings: Number(body.maxStrings) || 0, rules: body.rules || 'builtin+user' }, { ...rt.ctx, session: 'ui-api', step: 1 });
      if (!out.ok) return json(res, 422, { ok: false, error: out.error?.message || 'the analysis failed', hint: out.error?.hint || null });
      return json(res, 200, { ok: true, result: out.result, meta: out.meta, spilled: out.spilled });
    }
    if (p === '/api/selftest' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      const out = await registry.exec('majin.selftest', { level: body.level === 'full' ? 'full' : 'quick' }, { ...rt.ctx, session: 'ui-api', step: 1 });
      return json(res, 200, { ok: out.ok !== false, text: out.result, meta: out.meta || null, error: out.error?.message || null });
    }
    if (p === '/api/dataset' && req.method === 'POST') {
      const body = await readJson(req).catch(() => ({}));
      const out = await registry.exec('majin.dataset', { ...body }, { ...rt.ctx, session: 'ui-api', step: 1 });
      return json(res, out.ok === false ? 422 : 200, { ok: out.ok !== false, text: out.result, meta: out.meta || null, error: out.error?.message || null, hint: out.error?.hint || null });
    }
    if (p === '/api/tool' && req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.tool || body.name || '');
      if (!name) return json(res, 400, { ok: false, error: 'tool missing' });
      const out = await registry.exec(name, body.args || {}, { ...rt.ctx, session: 'ui-api', step: 1 });
      return json(res, 200, { ok: out.ok !== false, result: out.result, meta: out.meta || null, error: out.error || null, ms: out.ms });
    }
    if (p === '/api/usage/reset' && req.method === 'POST') {
      const ok = usage.reset ? usage.reset() : false;
      return json(res, 200, { ok, note: ok ? 'month reset' : 'usage.reset is not in this build' });
    }
    if (p === '/api/restart' && req.method === 'POST') {
      json(res, 200, { ok: true, restart: true, note: 'shutting down with code 75 — majin start will bring it back' });
      setTimeout(() => {
        try {
          server.close();
        } catch {
          /* */
        }
        process.exit(75);
      }, 250);
      return;
    }
    if (p === '/api/shutdown' && req.method === 'POST') {
      json(res, 200, { ok: true, bye: true });
      setTimeout(() => process.emit('SIGTERM', 'SIGTERM'), 120);
      return;
    }
    return json(res, 404, { ok: false, error: `unknown route ${p}`, hint: 'see /api/state for everything that exists' });
  }

  return server;
}

/* ------------------------------- helpers --------------------------------- */

/**
 * Local-first: localhost (och sandbox-förhandsvisningen .e2b.app) litar vi på utan
 * token i URL:en — allt annat kräver nyckeln. Stäng av med server.trustLocal:false.
 */
// Betrodda värdar utan token: loopback (lokalhost, 127.x, ::1) och sandbox-förhandsvisning.
const TRUSTED = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|[\w-]+\.e2b\.app)$/i;

const LOCAL_PEER = /^(127\.|::1$)/;

export function authOk(req, url, token, cfg, peer = '') {
  if (!token) return true;
  if (url.searchParams.get('t') === token || url.searchParams.get('token') === token) return true;
  const h = req.headers.authorization || '';
  if (h === `Bearer ${token}` || h === `majin ${token}`) return true;
  if ((req.headers.cookie || '').split(/;\s*/).includes(`majin=${token}`)) return true;
  if (req.headers['x-majin-token'] === token) return true;
  const host = String(req.headers.host || '').split(':')[0];
  if (!TRUSTED.test(host)) return false;
  // Betrodd värd räcker bara om paketet faktiskt kommer lokalt (eller att remote uttryckligen
  // tillåtits) — annars räcker det att lura ett DNS-namn för att bli "localhost".
  const fromLocalHost = peer === '' || LOCAL_PEER.test(peer);
  if (cfg?.get?.('server.allowRemote') === true) return true;
  if (cfg?.get?.('server.trustLocal') !== false && fromLocalHost) return true;
  return false;
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'access-control-allow-origin': '*' });
  return res.end(body);
}

function text(res, code, s) {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' });
  return res.end(s);
}

function html(res, code, s) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(s), 'cache-control': 'no-store' });
  return res.end(s);
}

function sseHead(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'access-control-allow-origin': '*',
    'x-accel-buffering': 'no',
  });
  res.write(': majin\n\nretry: 15000\n\n');
}

function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > max) {
        reject(Object.assign(new Error(`body too large (${n} > ${max})`), { code: 'too_big' }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 20 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return Object.fromEntries(new URLSearchParams(buf.toString('utf8')).entries());
  }
}

function countLines(abs) {
  try {
    let n = 0;
    const buf = fs.readFileSync(abs, 'utf8');
    for (let i = 0; i < buf.length; i += 1) if (buf[i] === '\n') n += 1;
    return n;
  } catch {
    return 0;
  }
}

function sanitize(name) {
  return path.basename(String(name)).replace(/[^\w.\-+()]/g, '_').slice(0, 140) || 'prov.bin';
}

export { VERSION };
