/**
 * MAJIN — web.
 * Search without an API key (duckduckgo/bing/searxng) plus a fetch that returns clean text.
 * `web.download` is the RE shortcut: fetch the sample, analyze it, skip the browser.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { def } from './registry.js';
import { resolveIn } from './files.js';
import { bus } from '../log.js';
import { openFor, closeFor, isOpen, journal } from '../browser.js';

const followedSafe = (fol) => (fol && fol.followed === true ? true : false);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36 MAJIN/1.0';

async function httpGet(url, { headers = {}, timeoutSec = 25, maxBytes = 4_000_000, method = 'GET', body = null } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutSec * 1000);
  t.unref?.();
  try {
    const res = await fetch(url, { method, body, redirect: 'follow', headers: { 'user-agent': UA, accept: '*/*', ...headers }, signal: ctrl.signal });
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    return { ok: res.ok, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: buf.subarray(0, maxBytes), truncated: buf.length > maxBytes, url: res.url };
  } finally {
    clearTimeout(t);
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', eacute: 'é', auml: 'ä', ouml: 'ö', aring: 'å', copy: '©', deg: '°' };
      if (/^#x([0-9a-f]+)$/i.test(e)) return String.fromCodePoint(parseInt(/#x([0-9a-f]+)$/i.exec(e)[1], 16));
      if (/^#\d+$/.test(e)) return String.fromCodePoint(Number(e.slice(1)));
      return map[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ');
}

export function htmlToText(html) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(script|style|noscript|svg|form|nav|footer|header|iframe)[\s\S]*?<\/\1>/gi, ' ');
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/pre)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function searchDuckDuckGo(query, count) {
  const r = await httpGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { timeoutSec: 20 });
  if (!r.ok) throw new Error(`duckduckgo ${r.status}`);
  const html = r.body.toString('utf8');
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]{0,400}?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && out.length < count) {
    let url = decodeEntities(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(url);
    if (uddg) url = decodeURIComponent(uddg[1]);
    out.push({ title: strip(m[2]), url, snippet: strip(m[3]) });
  }
  if (out.length) return { engine: 'duckduckgo', results: out };
  const loose = [...html.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]{4,120}?)<\/a>/g)]
    .filter((x) => !/duckduckgo\.com/.test(x[1]))
    .slice(0, count)
    .map((x) => ({ title: strip(x[2]), url: x[1], snippet: '' }));
  return { engine: 'duckduckgo(loose)', results: loose };
}

async function searchBing(query, count) {
  const r = await httpGet(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${count}`, { timeoutSec: 20, headers: { 'accept-language': 'en-US,en;q=0.9' } });
  const html = r.body.toString('utf8');
  const results = [];
  for (const m of html.matchAll(/<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]{0,700}?)<\/li>/g)) {
    results.push({ title: strip(m[2]), url: m[1], snippet: strip(m[3].replace(/<[^>]+>/g, ' ')) });
    if (results.length >= count) break;
  }
  return { engine: 'bing', results };
}

async function searchSearxng(query, count, base) {
  const r = await httpGet(`${String(base).replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json`, { timeoutSec: 20 });
  const j = JSON.parse(r.body.toString('utf8'));
  return { engine: 'searxng', results: (j.results || []).slice(0, count).map((x) => ({ title: strip(x.title), url: x.url, snippet: strip(x.content || '') })) };
}

async function searchBrave(query, count, key) {
  const r = await httpGet(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`, { headers: { 'x-subscription-token': key } });
  const j = JSON.parse(r.body.toString('utf8'));
  return { engine: 'brave', results: (j.web?.results || []).slice(0, count).map((x) => ({ title: strip(x.title), url: x.url, snippet: strip(x.description) })) };
}

function strip(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, '')).trim();
}

const cache = new Map();
const CACHE_MS = 15 * 60 * 1000;

export const webTools = [
  def({
    name: 'web.search',
    group: 'web',
    risk: 'read',
    desc: 'Search the web. No API key needed (duckduckgo/bing fallback). Returns title, url and snippet.',
    params: { query: 'string: what to look for', count: 'number: results to return (default 8)', engine: 'string: auto | duckduckgo | bing | searxng | brave [auto|duckduckgo|bing|searxng|brave]' },
    examples: ['web.search({query:"pe file format data directories"})'],
    async run({ query, count = 8, engine = 'auto' }, ctx) {
      const key = `search:${engine}:${query}`;
      const hit = cache.get(key);
      if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.res, meta: { ...hit.res.meta, cached: true } };
      const cfg = ctx.cfg;
      const braveKey = cfg.get('tools.web.braveKey');
      const searx = cfg.get('tools.web.searxng');
      const order = engine === 'auto' ? [searx && 'searxng', braveKey && 'brave', 'duckduckgo', 'bing'].filter(Boolean) : [engine];
      const errors = [];
      for (const e of order) {
        try {
          const res = e === 'searxng' ? await searchSearxng(query, count, searx) : e === 'brave' ? await searchBrave(query, count, braveKey) : e === 'bing' ? await searchBing(query, count) : await searchDuckDuckGo(query, count);
          if (res.results.length) {
            const body = res.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
            const out = { ok: true, result: `${res.engine}: ${res.results.length} results for "${query}"\n\n${body}`, meta: { engine: res.engine, count: res.results.length, query }, summary: `${res.engine} ${res.results.length} results` };
            cache.set(key, { at: Date.now(), res: out });
            return out;
          }
          errors.push(`${e}: 0 results`);
        } catch (err) {
          errors.push(`${e}: ${err.message}`);
        }
      }
      return { ok: false, error: { code: 'search_failed', message: `no search engine answered (${errors.join('; ')})`, hint: 'set tools.web.searxng or tools.web.braveKey in the config, or check internet access' } };
    },
  }),

  def({
    name: 'web.fetch',
    group: 'web',
    risk: 'read',
    desc: 'Fetch a URL as clean text (or json/raw). Use for docs, APIs and pages. Follows redirects, size-capped.',
    params: {
      url: 'string: http(s) address',
      extract: 'string: text | html | json | raw [text|html|json|raw]',
      maxChars: 'number: max characters in the response (default 24000)',
      method: 'string: GET | POST | PUT | DELETE [GET|POST|PUT|DELETE]',
      headers: 'object: extra headers',
      body: 'string: request body for POST/PUT',
    },
    examples: ['web.fetch({url:"https://api.deepseek.com/models"})'],
        required: ['url'],
async run({ url, extract = 'text', maxChars = 24000, method = 'GET', headers = {}, body }, ctx) {
      if (!/^https?:\/\//i.test(url)) throw new Error('url must start with http:// or https://');
      const t0 = Date.now();
      const r = await httpGet(url, { timeoutSec: ctx.cfg.get('tools.web.timeoutSec') || 25, method, headers, body });
      const type = r.headers['content-type'] || '';
      let text;
      let note = '';
      if (extract === 'raw') text = r.body.subarray(0, 4000).toString('latin1');
      else if (extract === 'html' || (extract === 'text' && /json/i.test(type))) text = r.body.toString('utf8');
      else if (extract === 'text' && /html/i.test(type)) text = htmlToText(r.body.toString('utf8'));
      else text = r.body.toString('utf8');
      if (extract === 'json' || /json/i.test(type)) {
        try {
          text = JSON.stringify(JSON.parse(r.body.toString('utf8')), null, 1);
        } catch {
          note = '(kunde inte parsa som json)';
        }
      }
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n…[${text.length - maxChars} chars clipped]` : text;
      ctx.emit?.({ type: 'web', url, status: r.status, chars: text.length });
      if (!r.ok) return { ok: false, error: { code: `http_${r.status}`, message: `${r.status} for ${r.url}`, hint: r.status === 403 ? 'blocked (bot protection). Try another source or web.download.' : null } };
      return {
        ok: true,
        result: `${r.status} ${r.url} · ${type.split(';')[0] || 'unknown type'} · ${r.body.length} byte${note ? ` ${note}` : ''}\n\n${clipped}`,
        meta: { status: r.status, url: r.url, bytes: r.body.length, ms: Date.now() - t0, contentType: type },
        summary: `${r.status} ${new URL(r.url).host} (${r.body.length} byte)`,
      };
    },
  }),

  def({
    name: 'web.download',
    group: 'web',
    risk: 'write',
    desc: 'Download a file into the workspace (samples, archives, documents). Executables require an approval — an agent should not run something by accident.',
    params: { url: 'string: address', path: 'string: target file (default under uploads/)', sha256: 'string: expected hash, verified when given' },
    async run({ url, path: p, sha256 }, ctx) {
      if (!/^https?:\/\//i.test(url)) throw new Error('url must be http(s)');
      const name = p || path.join('downloads', path.basename(new URL(url).pathname) || 'file.bin');
      const { abs } = resolveIn(ctx, name);
      const r = await httpGet(url, { timeoutSec: 120, maxBytes: ctx.cfg.get('tools.re.maxFileBytes') || 268435456 });
      if (!r.ok) return { ok: false, error: { code: `http_${r.status}`, message: `${r.status} for ${url}` } };
      const crypto = await import('node:crypto');
      const digest = crypto.createHash('sha256').update(r.body).digest('hex');
      if (sha256 && digest !== sha256.toLowerCase()) {
        return { ok: false, error: { code: 'hash_mismatch', message: `sha256 ${digest} ≠ ${sha256}`, hint: 'the file changed or the link is wrong' } };
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, r.body);
      bus.info('download', { url, bytes: r.body.length, path: abs });
      return {
        result: `saved ${abs} (${r.body.length} bytes, sha256 ${digest})\nRun re.triage({path:"${abs}") to analyze it.`,
        meta: { path: abs, bytes: r.body.length, sha256: digest },
        summary: `downloaded ${path.basename(abs)} (${Math.round(r.body.length / 1024)} kB)`,
      };
    },
  }),

  /* -------------------------------- browser-use --------------------------------
     The agent drives the browser already on this machine via CDP: one window
     with one profile per agent session (never each other's tabs), a global
     instance cap, a deterministic loop guard and evidence-in-every-answer. */

  def({
    name: 'browser.open',
    group: 'web',
    risk: 'exec',
    desc: 'Open a URL in a browser window MAJIN drives (Chrome or Edge on this machine). One window per task; capped fleet. Use browser.read/click/fill/shot next.',
    params: { url: 'string: http(s) address', headless: 'boolean: no visible window (default true)' },
    examples: ['browser.open({url:"https://example.com"})'],
    async run({ url, headless = true }, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, `browser.open:${url}`);
      try {
        const b = await openFor({ session, url: String(url), headless, cfgGet: (k) => ctx.cfg.get(k) });
        const meta = await b.eval('(() => ({ url: location.href, title: document.title }))()');
        return {
          ok: true,
          result: `opened — page says: "${meta.title}" at ${meta.url}`,
          meta: { url: meta.url, title: meta.title },
          summary: `opened ${meta.title || meta.url}`,
        };
      } catch (err) {
        return { ok: false, error: { code: 'browser_open', message: err.message } };
      }
    },
  }),

  def({
    name: 'browser.read',
    group: 'web',
    risk: 'read',
    desc: 'Read visible text from the page (or one selector) — the actual words on the page, capped.',
    params: { selector: 'string: optional CSS selector — whole page when omitted' },
    async run({ selector = '' }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) }).catch(() => null);
      if (!b) return { ok: false, error: { code: 'browser_closed', message: 'browser is not open' } };
      const sel = JSON.stringify(String(selector || ''));
      const expr = `(() => {
        const t = ${sel} ? (document.querySelector(${sel})?.innerText ?? null) : null;
        const body = t == null ? (document.body ? document.body.innerText : '') : t;
        return { ok: ${sel} ? t != null : true, url: location.href, title: document.title, text: String(body).slice(0, 12000) };
      })()`;
      const r = await b.eval(expr);
      journal.guard(session, `browser.read:${selector}`);
      if (!r.ok && selector) return { ok: false, error: { code: 'no_such_element', message: `no element matches ${selector}` } };
      return { ok: true, result: r.text || '(page is empty)', meta: { url: r.url, title: r.title, chars: (r.text || '').length }, summary: `${(r.text || '').length} chars from ${r.title || r.url}` };
    },
  }),

  def({
    name: 'browser.click',
    group: 'web',
    risk: 'exec',
    desc: 'Click an element by CSS selector and report what actually happened (element text + URL after the click). Screenshots via browser.shot when you need to look.',
    params: { selector: 'string: CSS selector of the thing to click' },
    examples: ['browser.click({selector:"button[type=submit]"})'],
    async run({ selector }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      journal.guard(session, `browser.click:${selector}`);
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      const sel = JSON.stringify(String(selector));
      const hit = await b.eval(`(() => {
        const el = document.querySelector(${sel});
        if (!el) return { found: false };
        el.scrollIntoView({ block: 'center' });
        const t = String(el.innerText || el.value || el.getAttribute('aria-label') || el.tagName).slice(0, 80);
        el.click();
        return { found: true, tag: String(el.tagName).toLowerCase(), text: t };
      })()`);
      if (!hit.found) return { ok: false, error: { code: 'no_such_element', message: `no clickable element matches ${selector}`, hint: 'browser.read the page and pick a selector from the real text' } };
      /* a click may spawn a NEW tab (target=_blank, window.open): follow it
         so the agent lands where the page actually went */
      const fol = await (b.followNewTarget ? b.followNewTarget({ windowMs: 1500 }) : { followed: false });
      const after = fol.followed ? { url: fol.url, title: fol.title } : await b.eval('(() => ({ url: location.href, title: document.title }))()');
      return {
        ok: true,
        result: `clicked ${hit.tag} "${hit.text}"${fol.followed ? ' (new tab followed)' : ''} — page now: "${after.title}" at ${after.url}`,
        meta: { tag: hit.tag, text: hit.text, urlAfter: after.url, title: after.title, openedNewTab: fol.followed },
        summary: `clicked "${hit.text}"`,
      };
    },
  }),

  def({
    name: 'browser.fill',
    group: 'web',
    risk: 'exec',
    desc: 'Type text into an input/textarea/select (real events — frameworks see it) and confirm the value stuck. Use browser.click for buttons and checkboxes.',
    params: { selector: 'string: CSS selector of the field', value: 'string: what to type' },
    async run({ selector, value }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      journal.guard(session, `browser.fill:${selector}`);
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      const sel = JSON.stringify(String(selector));
      const val = JSON.stringify(String(value ?? ''));
      const r = await b.eval(`(() => {
        const el = document.querySelector(${sel});
        if (!el) return { found: false };
        el.focus();
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${val}); else el.value = ${val};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, stuck: el.value === ${val}, value: el.value.slice(0, 40) };
      })()`);
      if (!r.found) return { ok: false, error: { code: 'no_such_element', message: `no field matches ${selector}`, hint: 'browser.read the page first' } };
      if (!r.stuck) return { ok: false, error: { code: 'value_rejected', message: 'the page reverted the value immediately — the field may have javascript validation', hint: 'type slower substrings or confirm the field with browser.shot' } };
      return { ok: true, result: `filled — page kept value "${r.value}"`, meta: { value: r.value }, summary: `filled ${selector}` };
    },
  }),

  def({
    name: 'browser.shot',
    group: 'web',
    risk: 'read',
    desc: 'Screenshot the current page to the workspace (visual evidence — attach it or verify with your own eyes).',
    params: {},
    async run(_, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      const shot = await b.send('Page.captureScreenshot', { format: 'png' });
      const dir = path.join(ctx.cfg.get('workspace'), 'shots');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `shot-${session.replace(/[^\w.-]/g, '_')}-${Date.now()}.png`);
      await fs.writeFile(file, Buffer.from(shot.data, 'base64'));
      ctx.bus?.emit?.('file.write', { path: file, bytes: shot.data.length * 0.75 | 0 });
      return { ok: true, result: `screenshot saved: ${file}`, meta: { path: file }, summary: `shot ${path.basename(file)}` };
    },
  }),

  def({
    name: 'browser.upload',
    group: 'web',
    risk: 'exec',
    desc: 'Attach a local file to a page file input (<input type=file>) — CV/portfolio uploads. The confirmation comes from the page itself.',
    params: { selector: 'string: CSS selector of the file input', path: 'string: local file to upload (inside the workspace)' },
    async run({ selector, path: p }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      journal.guard(session, `browser.upload:${selector}`);
      const { resolveIn } = await import('./files.js');
      const { abs } = resolveIn(ctx, p);
      const st = await fs.stat(abs).catch(() => null);
      if (!st || !st.isFile()) return { ok: false, error: { code: 'no_file', message: `no such file: ${abs}` } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      const sel = JSON.stringify(String(selector));
      await b.send('DOM.enable');
      const { root } = await b.send('DOM.getDocument');
      const { nodeId } = await b.send('DOM.querySelector', { nodeId: root.nodeId, selector: String(selector) });
      if (!nodeId) return { ok: false, error: { code: 'no_such_element', message: `no file input matches ${selector}`, hint: 'browser.read the page or browser.shot it; find the real input' } };
      await b.send('DOM.setFileInputFiles', { files: [abs], nodeId });
      const confirm = await b.eval(`(() => {
        const el = document.querySelector(${sel});
        const f = el && el.files && el.files[0];
        return f ? { ok: true, name: f.name, size: f.size } : { ok: false };
      })()`);
      if (!confirm.ok) return { ok: false, error: { code: 'no_upload', message: 'the input did not accept the file', hint: 'screenshot the page and check for a custom uploader' } };
      return { ok: true, result: `uploaded — page now holds "${confirm.name}" (${confirm.size} bytes)`, meta: { name: confirm.name, size: confirm.size, path: abs }, summary: `uploaded ${confirm.name}` };
    },
  }),

  def({
    name: 'browser.close',
    group: 'web',
    risk: 'write',
    desc: 'Close this task’s browser window and give the slot back to the fleet.',
    params: {},
    async run(_, ctx) {
      const closed = await closeFor(ctx.session || 'default', { wait: true });
      return { ok: true, result: closed ? 'browser closed, slot released' : 'no browser was open for this task', meta: { closed }, summary: closed ? 'closed' : 'nothing open' };
    },
  }),
];

export { httpGet };
