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
import { GROUND_JS, CLEAR_JS, rememberRefs, recallRef, clearRefs, renderElementsText, diffGroundSnapshot, findGroundedControls, VERSION as GROUND_V } from '../browser-ground.js';
import { VISIBLE_CONTROLS_JS, formatControlHints } from '../browser-control-hints.js';
import { SEMANTIC_SNAPSHOT_JS, formatSemanticSnapshot } from '../browser-semantic.js';
import { VERIFY_JS, verificationCriteria, verifyObserved } from '../browser-evidence.js';
import { browserActionReceipt } from '../browser-action-receipt.js';

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
    params: { query: 'string: what to look for', count: 'number: results to return (default: 8)', engine: 'string: auto | duckduckgo | bing | searxng | brave. optional (default: auto) [auto|duckduckgo|bing|searxng|brave]' },
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
      extract: 'string: text | html | json | raw. optional (default: text) [text|html|json|raw]',
      maxChars: 'number: max characters in the response (default: 24000)',
      method: 'string: GET | POST | PUT | DELETE. optional (default: GET) [GET|POST|PUT|DELETE]',
      headers: 'object: extra headers (optional)',
      body: 'string: request body for POST/PUT (optional)',
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
    params: { url: 'string: address', path: 'string: target file (default: under uploads/)', sha256: 'string: expected hash, verified when given (optional)' },
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
    params: { url: 'string: http(s) address', headless: 'boolean: no visible window (default: true)' },
    examples: ['browser.open({url:"https://example.com"})'],
    async run({ url, headless = true }, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, `browser.open:${url}`);
      try {
        const b = await openFor({ session, url: String(url), headless, cfgGet: (k) => ctx.cfg.get(k) });
        const meta = await b.eval('(() => ({ url: location.href, title: document.title }))()');
        const controls = await b.eval(VISIBLE_CONTROLS_JS).catch(() => []);
        return {
          ok: true,
          result: `opened — page says: "${meta.title}" at ${meta.url}` + formatControlHints(controls),
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
    params: { selector: 'string: optional CSS selector — whole page when omitted', mode: 'string optional "structure" for compact accessibility outline without form values' },
    async run({ selector = '', mode = '' }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) }).catch(() => null);
      if (!b) return { ok: false, error: { code: 'browser_closed', message: 'browser is not open' } };
      if(String(mode).toLowerCase()==='structure'){
        const payload=await b.eval(SEMANTIC_SNAPSHOT_JS).catch(e=>({error:String(e?.message||e)}));
        if(payload?.error)return {ok:false,error:{code:'structure_failed',message:payload.error}};
        const result=formatSemanticSnapshot(payload);
        journal.guard(session,'browser.read:structure');
        return {ok:true,result,meta:{url:payload.url,title:payload.title,mode:'structure',count:payload.elements?.length||0},summary:'Page structure observed ('+(payload.elements?.length||0)+' elements)'};
      }
      const sel = JSON.stringify(String(selector || ''));
      const expr = `(() => {
        const t = ${sel} ? (document.querySelector(${sel})?.innerText ?? null) : null;
        const body = t == null ? (document.body ? document.body.innerText : '') : t;
        return { ok: ${sel} ? t != null : true, url: location.href, title: document.title, text: String(body).slice(0, 12000) };
      })()`;
      const r = await b.eval(expr);
      journal.guard(session, `browser.read:${selector}`);
      if (!r.ok && selector) return { ok: false, error: { code: 'no_such_element', message: `no element matches ${selector}` } };
      const controls = selector ? [] : await b.eval(VISIBLE_CONTROLS_JS).catch(() => []);
      return { ok: true, result: (r.text || '(page is empty)') + formatControlHints(controls),
        meta: { url: r.url, title: r.title, chars: (r.text || '').length, groundedControls: Array.isArray(controls) ? controls.length : 0 },
        summary: `${(r.text || '').length} chars from ${r.title || r.url}` };
    },
  }),

  def({
    name: 'browser.click',
    group: 'web',
    risk: 'exec',
    desc: 'Click an element by CSS selector and report what actually happened (element text + URL after the click). Screenshots via browser.shot when you need to look.',
    params: {
      selector: 'string: CSS selector of the thing to click (optional — or give ref)',
      ref: 'string: numbered element reference from browser.elements, e.g. "e3" (optional — or give selector)',
      role: 'string optional: button|link|checkbox|textbox, must also supply accessibleName',
      accessibleName: 'string optional: exact accessible label to select uniquely with role',
      expectSelector: 'string optional: unique selector that must be visible after the click',
      expectText: 'string optional: text that must appear inside expectSelector',
      expectUrl: 'string optional: URL fragment that must be present after the click',
      expectChecked: 'string optional true|false: expected checkbox state of expectSelector',
      verifyWaitMs: 'string optional 0–4000: maximum time for post-click verification (default 2500)',
    },
    examples: ['browser.click({selector:"button[type=submit]",expectSelector:"#success",expectText:"Saved"})', 'browser.click({ref:"e3",expectUrl:"/dashboard"})'],
    async run({ selector, ref, role, accessibleName, expectSelector, expectText, expectUrl, expectChecked, verifyWaitMs }, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      const semantic=Boolean(role || accessibleName);
      if(semantic && (selector || ref || !['button','link','checkbox','textbox'].includes(String(role||'')) ||
         !String(accessibleName||'').trim() || String(accessibleName).length>140)){
        return {ok:false,error:{code:'bad_input',message:'Use role+accessibleName together, uniquely, without selector/ref'}};
      }
      if(!selector && !ref && !semantic) return {ok:false,error:{code:'bad_input',message:'Provide selector, live ref, or role+accessibleName'}};

      const requiresVerification=Boolean(expectSelector || expectText || expectUrl || expectChecked != null);
      const expected=requiresVerification?verificationCriteria({
        selector:expectSelector,text:expectText,url:expectUrl,checked:expectChecked
      }):null;
      if(requiresVerification && !expected.ok) return {
        ok:false,error:{code:'bad_expectation',message:expected.reason}
      };
      journal.guard(session, `browser.click:${selector || ref || role+":"+accessibleName}`);
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      let sel, identity = null;
      if (ref) {
        const cached = recallRef(session, ref);
        if (!cached) return { ok: false, error: { code: 'ref_unknown', message: `no element known for ref "${ref}" in this session — run browser.elements first to ground the page` } };
        // Grounding refs are ephemeral. Lock to the observed element identity
        // so a DOM rerender cannot silently reassign an old eN to another link.
        identity = { tag: String(cached.tag||'').toLowerCase(),
          id: String(cached.id||''), href: String(cached.href||''),
          name: String(cached.name||''), text: String(cached.text||'').slice(0,70) };
        sel = JSON.stringify(`[data-majin-ref=${JSON.stringify(String(ref))}]`);
      } else {
        sel = JSON.stringify(String(selector || ''));
      }
      const semanticTarget=JSON.stringify(semantic ? {role:String(role),name:String(accessibleName).trim()} : null);
      const expectedIdentity=JSON.stringify(identity);
      const hit = await b.eval(`(() => {
        // Playwright-MCP-style unique target selection: acting on the first
        // of multiple matching buttons is unsafe, especially Submit/Buy.
        const semantic=${semanticTarget};
        let matches;
        if(semantic){
          const selectors={button:'button,[role="button"],input[type="button"],input[type="submit"]',
            link:'a[href],[role="link"]',checkbox:'input[type="checkbox"],[role="checkbox"]',
            textbox:'input:not([type="hidden"]):not([type="password"]),textarea,[role="textbox"]'};
          matches=[...document.querySelectorAll(selectors[semantic.role])].filter(el=>{
            const box=el.getBoundingClientRect(),sty=getComputedStyle(el);
            if(!box.width||!box.height||sty.display==='none'||sty.visibility==='hidden'||el.closest('[aria-hidden="true"],[inert]'))return false;
            const label=el.getAttribute('aria-label')||el.labels?.[0]?.textContent||el.getAttribute('title')||
              (['INPUT','TEXTAREA'].includes(el.tagName)?el.getAttribute('placeholder'):el.innerText)||'';
            return String(label).replace(/\\s+/g,' ').trim().toLocaleLowerCase()===semantic.name.toLocaleLowerCase();
          });
        }else matches=document.querySelectorAll(${sel});
        if (matches.length > 1) return {found:true,blocked:'ambiguous_target',
          matchCount:matches.length,tag:'',text:'Multiple matching controls'};
        const el = matches[0];
        if (!el) return { found: false };
        const expected = ${expectedIdentity};
        if (expected) {
          const current = {tag: el.tagName.toLowerCase(),id:el.id||'',
            href:el.href||'',name:el.name||'',
            text:String(el.innerText || el.getAttribute('aria-label') ||
              el.getAttribute('placeholder') || el.name || el.href || el.tagName)
              .replace(/\\s+/g,' ').trim().slice(0,70)};
          // Strong identity checks first; only compare text for anonymous
          // controls where the original text is their sole grounding key.
          const stableKey=expected.id || expected.href || expected.name;
          if (expected.tag!==current.tag || expected.id!==current.id ||
              expected.href!==current.href || expected.name!==current.name ||
              (!stableKey && ['button','a','summary'].includes(current.tag) && expected.text!==current.text))
            return {found:true,blocked:'ref_identity_changed',tag:current.tag,
              text:'stale element reference'};
        }
        
        el.scrollIntoView({ block: 'center' });
        // NEVER echo input.value: it can contain passwords, tokens, email or
        // uploaded data. Use rendered label/accessible name for click evidence.
        const t = String(el.innerText || el.labels?.[0]?.textContent ||
          el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').trim().slice(0, 80);
        const type = String(el.getAttribute('type') || '').toLowerCase();
        const isCheckbox = el.tagName === 'INPUT' && type === 'checkbox';
        const before = isCheckbox ? Boolean(el.checked) : null;
        // Inspired by Stagehand's observe-before-act contract: DOM .click()
        // succeeds even when a modal covers the button. Reject that false
        // success with actionable evidence rather than clicking blindly.
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if(style.display==='none' || style.visibility==='hidden' || Number(style.opacity)===0 ||
           rect.width<1 || rect.height<1) return {found:true,blocked:'hidden',tag:el.tagName.toLowerCase(),text:t};
        if(el.matches(':disabled,[aria-disabled="true"]') || el.closest('[inert]'))
          return {found:true,blocked:'disabled',tag:el.tagName.toLowerCase(),text:t};
        const x=Math.min(innerWidth-1,Math.max(0,rect.left+rect.width/2));
        const y=Math.min(innerHeight-1,Math.max(0,rect.top+rect.height/2));
        if(x<0 || y<0 || x>=innerWidth || y>=innerHeight)
          return {found:true,blocked:'outside_viewport',tag:el.tagName.toLowerCase(),text:t};
        const over=document.elementFromPoint(x,y);
        const associatedLabel=over?.closest?.('label');
        if(over && over!==el && !el.contains(over) && associatedLabel?.control!==el)
          return {found:true,blocked:'occluded',tag:el.tagName.toLowerCase(),text:t,
            coveringTag:String(over.tagName||'').toLowerCase(),
            coveringRole:String(over.closest('[role="dialog"],[aria-modal="true"],dialog')?.getAttribute('role')||'').slice(0,30),
            coveringId:String(over.id||'').slice(0,60)};
        el.click();
        return { found: true, tag: String(el.tagName).toLowerCase(), text: t,
          checked: isCheckbox ? Boolean(el.checked) : null,
          changed: isCheckbox ? Boolean(el.checked) !== before : null };
      })()`);
      if (hit.found && hit.blocked) {
        return {ok:false,error:{code:'click_blocked',
          message:'Browser click was NOT attempted: '+hit.blocked+' ('+hit.text+'). '+(
            hit.blocked==='occluded'?'Another page element overlaps the target. Inspect current controls or dismiss an actual visible dialog; do not blindly repeat the click.':
            hit.blocked==='disabled'?'Control is disabled or inert. Check required fields/permissions before retrying.':
            hit.blocked==='hidden'?'Target is not visible. Re-ground the page and find the visible control.':
            'Re-observe the current page before retrying.'
          ),
          reason:hit.blocked,coveringTag:hit.coveringTag||null,
          coveringRole:hit.coveringRole||null,coveringId:hit.coveringId||null,
          recovery:'browser.elements({refresh:"true"}) then choose a NEW grounded action'},
          meta:{blocked:hit.blocked,tag:hit.tag,text:hit.text,receipt:browserActionReceipt({reason:hit.blocked})},
          summary:'click blocked: '+hit.blocked};
      }
      if (!hit.found) {
        const code = ref ? 'ref_stale' : semantic ? 'semantic_target_missing' : 'no_such_element';
        // Small free LLMs tend to retry guessed selectors such as
        // #apply-button despite a real button named #submit on the page.
        // Include CURRENT DOM-derived selectors in the failed action itself.
        const controls = await b.eval(VISIBLE_CONTROLS_JS).catch(() => []);
        const candidates = formatControlHints(controls);
        return { ok: false, error: { code,
          message: ref ? `element ${ref} vanished from the DOM (page re-rendered?) — do not guess a replacement` : `no clickable element matches ${selector}`,
          hint: 'Use an EXACT selector from the visible controls below (or browser.elements for live numbered refs). Avoid browser.open again unless navigation is required.' + candidates,
        } };
      }
      /* a click may spawn a NEW tab (target=_blank, window.open): follow it
         so the agent lands where the page actually went */
      const fol = await (b.followNewTarget ? b.followNewTarget({ windowMs: 1500 }) : { followed: false });
      const after = fol.followed ? { url: fol.url, title: fol.title } : await b.eval('(() => ({ url: location.href, title: document.title }))()');
      // Stagehand-inspired deterministic action + evidence. No extra model
      // call and no second click. Only poll the outcome on the live page.
      let proof=null,attempts=0;
      if(requiresVerification){
        const script=VERIFY_JS.replace('__MAJIN_ARGS__',JSON.stringify(expected));
        const waitMs=Math.min(4000,Math.max(0,Math.trunc(Number(verifyWaitMs ?? 2500)||0)));
        const deadline=Date.now()+waitMs;
        for(;;){
          let observed;
          try{observed=await b.eval(script);}
          catch(e){return {ok:false,error:{code:'post_click_verify_error',message:String(e?.message||e)},
            meta:{clicked:hit.text,urlAfter:after.url,receipt:browserActionReceipt({dispatched:true,uncertain:true,reason:'verification_exception'})}};}
          attempts++;
          proof=verifyObserved(expected,observed);
          if(proof.ok || !observed?.valid || Date.now()>=deadline)break;
          await new Promise(resolve=>setTimeout(resolve,Math.min(200,Math.max(1,deadline-Date.now()))));
        }
        if(!proof.ok)return {ok:false,error:{
          code:'post_click_assertion_failed',
          message:'The click happened but its requested effect was NOT verified. Re-observe the page before trying a different approach.',
          failures:proof.failures
        },meta:{clicked:hit.text,attempts,observed:proof.observed,receipt:browserActionReceipt({dispatched:true,reason:'assertion_failed'})},summary:'click outcome NOT verified'};
      }
      return {
        ok: true,
        result: `Click dispatched on ${hit.tag} "${hit.text}"${typeof hit.checked === 'boolean' ? (hit.checked ? ' — checkbox CHECKED' : ' — checkbox UNCHECKED') : ''}${fol.followed ? ' (new tab followed)' : ''} — page now: "${after.title}" at ${after.url}${proof?.ok ? ' — EXPECTED OUTCOME VERIFIED' : ' — OUTCOME NOT VERIFIED: call browser.verify before declaring task done'}`,
        meta: { tag: hit.tag, text: hit.text, checked: hit.checked, checkboxChanged: hit.changed,
          urlAfter: after.url, title: after.title, openedNewTab: fol.followed,
          verified: proof?.ok === true, outcomeEvidence: proof?.ok ? 'postcondition' : 'action_only', verificationAttempts: attempts,
          receipt:browserActionReceipt({dispatched:true,verified:proof?.ok===true}) },
        summary: `${proof?.ok ? 'verified' : 'action only'} · clicked "${hit.text}"${typeof hit.checked === 'boolean' ? (hit.checked ? ' (checked)' : ' (unchecked)') : ''}`,
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
        // A checkbox/radio/button is an ACTION, not a value to overwrite.
        // Assigning input.value can corrupt a form submission without checking.
        const inputType = String(el.getAttribute('type') || '').toLowerCase();
        if (['checkbox', 'radio', 'submit', 'button', 'reset'].includes(inputType)) {
          return { found: true, wrongType: inputType };
        }
        el.focus();
        const proto = el.tagName === 'SELECT' ? window.HTMLSelectElement.prototype : (el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, ${val}); else el.value = ${val};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        // Report only equality with the requested input, never the raw value.
        return { found: true, stuck: el.value === ${val} };
      })()`);
      if (!r.found) {
        const controls = await b.eval(VISIBLE_CONTROLS_JS).catch(() => []);
        return { ok: false, error: { code: 'no_such_element', message: `no field matches ${selector}`,
          hint: 'Use EXACT selectors from these live controls. Checkboxes and buttons need browser.click, not browser.fill. Do not reopen the page to guess fields.' + formatControlHints(controls),
        } };
      }
      if (r.wrongType) {
        return { ok: false, error: { code: 'wrong_control_type', message: `browser.fill cannot set a ${r.wrongType}`,
          hint: 'Use browser.click with this exact selector and confirm the checked result. The control was not modified.' } };
      }
      if (!r.stuck) return { ok: false, error: { code: 'value_rejected', message: 'the page reverted the value immediately — the field may have javascript validation', hint: 'type slower substrings or confirm the field with browser.shot' } };
      return { ok: true, result: 'filled — browser confirmed input retained (value hidden)', meta: { retained: true, valueHidden: true }, summary: 'field filled and verified' };
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
    name: 'browser.verify',
    group: 'web',
    risk: 'read',
    desc: 'Verify a REAL post-action browser outcome. Checks live URL, title, element visibility, text and checkbox state. On failure returns FAILED with observed evidence — never calls a click successful merely because it executed. Use after browser.click/fill when the goal requires an effect.',
    params: {
      selector: 'string optional CSS selector to assert exists and is visible',
      present: 'string optional true|false, default true if selector set',
      text: 'string optional expected text fragment within selector',
      url: 'string optional expected URL fragment',
      title: 'string optional expected title fragment',
      checked: 'string optional true|false expected checkbox checked state',
      enabled: 'string optional true|false expected element enabled state (includes aria-disabled and inert)',
      waitMs: 'string optional: wait up to 0–5000ms for the expected DOM outcome (default 1800ms, immediate return on success)',
      stableMs: 'string optional 0–1500: require expected DOM state to stay true for this duration (default 0)',
    },
    examples: ['browser.verify({selector:"#success",text:"Saved"})', 'browser.verify({url:"/dashboard"})','browser.verify({selector:"input[name=consent]",checked:"true"})', 'browser.verify({selector:"#submit",enabled:"true"})'],
    async run(input, ctx) {
      const session = ctx.session || 'default';
      if (!isOpen(session)) return { ok:false,error:{code:'browser_closed',message:'Open the target page before verifying'} };
      const criteria=verificationCriteria(input);
      if(!criteria.ok)return {ok:false,error:{code:'bad_expectation',message:criteria.reason}};
      journal.guard(session, 'browser.verify:' + JSON.stringify(criteria).slice(0,250));
      const b=await openFor({session,cfgGet:k=>ctx.cfg.get(k)});
      const script=VERIFY_JS.replace('__MAJIN_ARGS__',JSON.stringify(criteria));
      const waitMs=Math.min(5000,Math.max(0,Math.trunc(Number(input?.waitMs ?? 1800)||0)));
      // React/Vue apps may briefly show a success node and immediately replace
      // it. Require sustained evidence when requested; don't report a flicker
      // as proof and never repeat the user's actual click.
      const stableMs=Math.min(1500,Math.max(0,Math.trunc(Number(input?.stableMs)||0)));
      const deadline=Date.now()+Math.max(waitMs,stableMs);
      let observed,verdict,firstPassingAt=null;
      for(;;){
        try { observed=await b.eval(script); }
        catch(e){ return {ok:false,error:{code:'browser_verify_error',message:String(e?.message||e)}}; }
        const now=Date.now();
        verdict=verifyObserved(criteria,observed);
        if(verdict.ok){
          if(firstPassingAt===null)firstPassingAt=now;
          if(now-firstPassingAt>=stableMs)break;
        } else firstPassingAt=null;
        if(now>=deadline) {
          if(verdict.ok && stableMs>0) verdict={...verdict,ok:false,
            failures:[{name:'stable_duration',expected:stableMs,actual:firstPassingAt===null?0:now-firstPassingAt}]};
          break;
        }
        await new Promise(resolve=>setTimeout(resolve,Math.min(120,Math.max(1,deadline-now))));
      }
      if(!verdict.ok){
        return {ok:false,error:{code:'assertion_failed',
          message:'Browser outcome NOT verified. Re-observe with browser.elements/read and choose a different recovery step; do not repeat an identical action.',
          failures:verdict.failures},meta:{assertions:verdict.assertions,observed:verdict.observed},
          summary:'verification FAILED'};
      }
      return {ok:true,result:'Verified live browser outcome: '+verdict.assertions.map(a=>a.name+'='+a.actual).join(', '),
        meta:{assertions:verdict.assertions,observed:verdict.observed},summary:'browser outcome VERIFIED'};
    },
  }),

  def({
    name: 'browser.elements',
    group: 'web',
    risk: 'read',
    desc: 'W6 Set-of-Marks grounding: number every interactive element on the open page, draw the matching pink marks on screen, and return the references so browser.click({ref:"eN"}) hits deterministically instead of guessing. Refs are of-the-moment evidence; a re-rendered DOM makes them stale (browser.click then says ref_stale honestly).',
    params: { refresh: 'string: "true" = re-walk the DOM now and replace the cached refs (optional, default: false)', query: 'string optional search for a specific control by name, role, or label; returns only matches to reduce model tokens', delta: 'string optional true: first snapshot is full, subsequent snapshots show only changes or unchanged; false is default' },
    examples: ['browser.elements({})', 'browser.elements({query:"submit button"})'],
    async run({ refresh, query = '', delta = 'false' }, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, 'browser.elements');
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser is open for this task — run browser.open first' } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      if (String(refresh) === 'true') clearRefs(session);
      const payload = await b.eval(GROUND_JS).catch((e) => ({ error: String(e?.message || e) }));
      if (payload?.error) return { ok: false, error: { code: 'ground_eval', message: 'page walk failed: ' + payload.error } };
      rememberRefs(session, payload.elements || []);
      const needle=String(query||'').trim();
      const matches=needle ? findGroundedControls(payload.elements||[],needle) : null;
      const visible=matches ? {...payload,elements:matches} : payload;
      const isDelta=String(delta)==='true';
      const snap=isDelta?diffGroundSnapshot(session,visible,{query:needle,reset:String(refresh)==='true',cap:needle?12:60}):null;
      const selected=snap?.mode==='delta' ? {...visible,elements:snap.changes} : visible;
      const baseText=needle && !matches.length
        ? `No grounded controls match "${needle.slice(0,100)}" on ${payload.url}. Refresh or try broader terms.`
        : renderElementsText(selected, {cap:needle?12:60});
      const result=snap?.mode==='unchanged'
        ? `No changes in ${payload.count} page controls at ${payload.url}. Previous references remain valid only if the page has not rerendered.`
        : snap?.mode==='delta'
          ? `Page controls updated: ${snap.changes.length} changed, ${snap.removed.length} removed. Removed references: ${snap.removed.join(', ')||'none'}. Current controls below:\n${baseText}`
          : baseText;
      return {
        ok: true,result,
        meta: {version:GROUND_V,count:payload.count,matched:matches?.length??null,
          url:payload.url,title:payload.title,deltaMode:snap?.mode??'off',
          changed:snap?.changes?.length??null,removed:snap?.removed?.length??null},
        summary: snap?.mode==='unchanged'?'Page controls unchanged':
          snap?.mode==='delta'?`${snap.changes.length} updated and ${snap.removed.length} removed controls`:
          needle?`${matches.length} matching controls among ${payload.count}`:`${payload.count} elements grounded on this page`,
      };
    },
  }),
def({
    name: 'browser.clear_marks',
    group: 'web',
    risk: 'write',
    desc: 'Remove all pink Set-of-Marks overlay numbers and cached refs — honest teardown marker (refs become ref_unknown after this).',
    params: { noParams: 'string: none (optional)' },
    examples: ['browser.clear_marks({})'],
    async run(_, ctx) {
      const session = ctx.session || 'default';
      journal.guard(session, 'browser.clear_marks');
      if (!isOpen(session)) return { ok: false, error: { code: 'browser_closed', message: 'no browser open' } };
      const b = await openFor({ session, cfgGet: (k) => ctx.cfg.get(k) });
      await b.eval(CLEAR_JS).catch(() => undefined);
      clearRefs(session);
      return { ok: true, result: 'marks + cached refs cleared on the page', summary: 'marks cleared' };
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
