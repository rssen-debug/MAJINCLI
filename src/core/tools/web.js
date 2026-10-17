/**
 * MAJIN — web.
 * Sök utan API-nyckel (duckduckgo/bing/searxng) och en fetch som ger ren text.
 * `web.download` är RE-genvägen: hämta provet, analysera det, slipp webbläsaren.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { def } from './registry.js';
import { resolveIn } from './files.js';
import { bus } from '../log.js';

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
    desc: 'Sök på webben. Inget API-nyckel behövs (duckduckgo/bing fallback). Returnerar titel, url, utdrag.',
    params: { query: 'string: vad du söker', count: 'number: antal träffar (default 8)', engine: 'string: auto | duckduckgo | bing | searxng | brave [auto|duckduckgo|bing|searxng|brave]' },
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
            const out = { ok: true, result: `${res.engine}: ${res.results.length} träffar för "${query}"\n\n${body}`, meta: { engine: res.engine, count: res.results.length, query }, summary: `${res.engine} ${res.results.length} träffar` };
            cache.set(key, { at: Date.now(), res: out });
            return out;
          }
          errors.push(`${e}: 0 träffar`);
        } catch (err) {
          errors.push(`${e}: ${err.message}`);
        }
      }
      return { ok: false, error: { code: 'search_failed', message: `ingen sökmotor svarade (${errors.join('; ')})`, hint: 'sätt tools.web.searxng eller tools.web.braveKey i config, eller kontrollera internetåtkomsten' } };
    },
  }),

  def({
    name: 'web.fetch',
    group: 'web',
    risk: 'read',
    desc: 'Hämta en URL och få ren text (eller json/rådata). Används för dokumentation, API:er, sidor. Följer redirects, cap:ad storlek.',
    params: {
      url: 'string: http(s)-adress',
      extract: 'string: text | html | json | raw [text|html|json|raw]',
      maxChars: 'number: max tecken i svar (default 24000)',
      method: 'string: GET | POST | PUT | DELETE [GET|POST|PUT|DELETE]',
      headers: 'object: extra headers',
      body: 'string: request body för POST/PUT',
    },
    examples: ['web.fetch({url:"https://api.deepseek.com/models"})'],
        required: ['url'],
async run({ url, extract = 'text', maxChars = 24000, method = 'GET', headers = {}, body }, ctx) {
      if (!/^https?:\/\//i.test(url)) throw new Error('url måste börja med http:// eller https://');
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
      const clipped = text.length > maxChars ? `${text.slice(0, maxChars)}\n…[${text.length - maxChars} tecken klippt]` : text;
      ctx.emit?.({ type: 'web', url, status: r.status, chars: text.length });
      if (!r.ok) return { ok: false, error: { code: `http_${r.status}`, message: `${r.status} för ${r.url}`, hint: r.status === 403 ? 'blockerad (bot-skydd). Försök en annan källa eller web.download.' : null } };
      return {
        ok: true,
        result: `${r.status} ${r.url} · ${type.split(';')[0] || 'okänd typ'} · ${r.body.length} byte${note ? ` ${note}` : ''}\n\n${clipped}`,
        meta: { status: r.status, url: r.url, bytes: r.body.length, ms: Date.now() - t0, contentType: type },
        summary: `${r.status} ${new URL(r.url).host} (${r.body.length} byte)`,
      };
    },
  }),

  def({
    name: 'web.download',
    group: 'web',
    risk: 'write',
    desc: 'Ladda ner en fil till workspace (prover, arkiv, dokument). Körtbara filer kräver ett godkännande — du vill inte att en agent ska exekvera något av misstag.',
    params: { url: 'string: adress', path: 'string: målfil (default under uploads/)', sha256: 'string: förväntad hash, verifieras om given' },
    async run({ url, path: p, sha256 }, ctx) {
      if (!/^https?:\/\//i.test(url)) throw new Error('url måste vara http(s)');
      const name = p || path.join('downloads', path.basename(new URL(url).pathname) || 'file.bin');
      const { abs } = resolveIn(ctx, name);
      const r = await httpGet(url, { timeoutSec: 120, maxBytes: ctx.cfg.get('tools.re.maxFileBytes') || 268435456 });
      if (!r.ok) return { ok: false, error: { code: `http_${r.status}`, message: `${r.status} för ${url}` } };
      const crypto = await import('node:crypto');
      const digest = crypto.createHash('sha256').update(r.body).digest('hex');
      if (sha256 && digest !== sha256.toLowerCase()) {
        return { ok: false, error: { code: 'hash_mismatch', message: `sha256 ${digest} ≠ ${sha256}`, hint: 'filen har ändrats eller så är länken fel' } };
      }
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, r.body);
      bus.info('download', { url, bytes: r.body.length, path: abs });
      return {
        result: `sparade ${abs} (${r.body.length} byte, sha256 ${digest})\nKör re.triage({path:"${abs}"}) för analys.`,
        meta: { path: abs, bytes: r.body.length, sha256: digest },
        summary: `laddade ner ${path.basename(abs)} (${Math.round(r.body.length / 1024)} kB)`,
      };
    },
  }),
];

export { httpGet };
