/**
 * Browser automation powered by Playwright Core (no model/provider dependency).
 * The browser is intentionally isolated in MAJIN's own persistent profile.
 * Remote writes require an exact origin grant supplied by the owning runtime.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { def } from './registry.js';
import { dirs } from '../paths.js';

const sessions = new Map();

export function browserWriteAllowed(ctx, url) {
  try { const parsed = new URL(url); return !parsed.username && !parsed.password && (ctx.browserWriteOrigins || []).includes(parsed.origin); } catch { return false; }
}

function stateFor(ctx) {
  const key = String(ctx.session || 'desktop');
  if (!sessions.has(key)) sessions.set(key, { context: null, page: null, browserType: null, headless: true, lock: Promise.resolve(), blockedRequests: [] });
  return sessions.get(key);
}

function requirePage(ctx) {
  const p = stateFor(ctx).page;
  if (!p || p.isClosed()) throw new Error('browser is not open; call browser.open first');
  return p;
}

function audit(ctx, action, detail = {}, p = stateFor(ctx).page) {
  const record = { type: 'browser:action', action, url: p?.url?.() || null, ...detail };
  ctx.emit?.(record);
  return record;
}

async function withSession(ctx, fn) {
  const state = stateFor(ctx);
  const previous = state.lock;
  let release;
  state.lock = new Promise((resolve) => { release = resolve; });
  await previous;
  try {
    return await fn(state);
  } finally {
    release();
  }
}

function withPage(ctx, fn) {
  return withSession(ctx, () => fn(requirePage(ctx)));
}

function chromePath() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

async function loadChromium() {
  try {
    const pw = await import('playwright-core');
    return pw.chromium;
  } catch (err) {
    const e = new Error('Playwright Core is not installed. Install dependencies with `npm install` and try again.');
    e.cause = err;
    throw e;
  }
}

async function safeClick(p, selector, index, ctx) {
  const locator = p.locator(selector);
  const count = await locator.count();
  if (!count) throw new Error(`no element matched selector: ${selector}`);
  if (index == null && count !== 1) throw new Error(`${count} elements matched; specify index (0-based) to choose one`);
  const target = locator.nth(index ?? 0);
  const meta = await target.evaluate((el) => ({
    tag: el.tagName.toLowerCase(),
    type: String(el.type || '').toLowerCase(),
    role: (el.getAttribute('role') || '').toLowerCase(),
    text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().slice(0, 160),
  }));
  const submitLabel = /\b(apply|submit|send application|skicka ansökan|skicka ansokan|skicka ansökan|ansök nu|ansok nu)\b/i.test(meta.text);
  if (!browserWriteAllowed(ctx, p.url()) && ((meta.tag === 'button' && meta.type === 'submit') || (meta.tag === 'input' && ['submit', 'image'].includes(meta.type)) || meta.role === 'submit' || (['button', 'input'].includes(meta.tag) && submitLabel))) {
    throw new Error(`blocked final form-submit control (${meta.text || selector}). Forms can be prepared, but submitting is intentionally unavailable.`);
  }
  await target.click();
  await p.waitForTimeout(200);
  return meta;
}

function validateUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('url must be a valid http(s) URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('only http(s) URLs are allowed');
  return parsed.toString();
}

export const browserTools = [
  def({
    name: 'browser.open',
    group: 'browser',
    risk: 'read',
    desc: 'Open or navigate a real browser page using Playwright Core. Uses an isolated persistent MAJIN profile. By default tools never submit forms. The owner host can authorize writes to exact origins; a model cannot grant this permission.',
    params: {
      url: 'string: http(s) page to open',
      headless: 'boolean: run without a visible browser window (default true)',
      executablePath: 'string: optional Chrome/Edge/Chromium executable path',
    },
    examples: ['browser.open({url:"https://example.com",headless:false})'],
    required: ['url'],
    async run({ url, headless = true, executablePath = '' }, ctx) {
      const targetUrl = validateUrl(url);
      return withSession(ctx, async (state) => {
        if (!state.context || !state.page || state.page.isClosed()) {
          state.browserType = await loadChromium();
          fs.mkdirSync(dirs.cache, { recursive: true });
          const executable = executablePath || chromePath();
          const profile = createHash('sha256').update(String(ctx.session || 'desktop')).digest('hex').slice(0, 16);
          state.context = await state.browserType.launchPersistentContext(path.join(dirs.cache, `browser-profile-${profile}`), {
            headless: Boolean(headless),
            ...(executable ? { executablePath: executable } : {}),
            viewport: { width: 1440, height: 1000 },
            acceptDownloads: true,
            serviceWorkers: 'block',
          });
          state.headless = Boolean(headless);
          state.context.setDefaultTimeout(12000);
          state.page = state.context.pages()[0] || await state.context.newPage();
          state.context.on('page', (newPage) => newPage.on('dialog', (dialog) => dialog.dismiss().catch(() => {})));
          // Defense in depth: stop native form submits in every tab before site handlers run.
          await state.context.addInitScript((origins) => {
            document.addEventListener('submit', (event) => {
              const action = event.submitter?.formAction || event.target.action || location.href;
              if (origins.includes(location.origin) && origins.includes(new URL(action, location.href).origin)) return;
              event.preventDefault();
              event.stopImmediatePropagation();
            }, true);
          }, [...(ctx.browserWriteOrigins || [])]);
          // Stop JS-driven writes too; this workflow prepares forms but never sends them.
          await state.context.route('**/*', async (route) => {
            const method = route.request().method().toUpperCase();
            if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
              const request = route.request();
              let frameUrl = '';
              try { frameUrl = request.frame().url(); } catch { /* no trusted frame */ }
              if (browserWriteAllowed(ctx, request.url()) && browserWriteAllowed(ctx, frameUrl)) {
                await route.continue(); return;
              }
              ctx.emit?.({ type: 'browser:blocked-request', method, url: route.request().url() });
              const blockedUrl = new URL(route.request().url());
              state.blockedRequests.push({ method, origin: blockedUrl.origin, path: blockedUrl.pathname });
              state.blockedRequests = state.blockedRequests.slice(-30);
              await route.abort('blockedbyclient').catch(() => {});
              return;
            }
            await route.continue();
          });
        }
        await state.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await state.page.waitForTimeout(350);
        const result = { url: state.page.url(), title: await state.page.title(), headless: state.headless, submissionsBlocked: !browserWriteAllowed(ctx, state.page.url()) };
        audit(ctx, 'open', { url: result.url, title: result.title, headless: result.headless }, state.page);
        return { result: `Opened ${result.url}\nTitle: ${result.title}\n${result.submissionsBlocked ? 'Form submissions and non-read HTTP requests are blocked.' : 'Owner-authorized writes are enabled for this exact origin.'}`, meta: result, summary: `opened ${new URL(result.url).host}` };
      });
    },
  }),

  def({
    name: 'browser.inspect',
    group: 'browser',
    risk: 'read',
    desc: 'Inspect the current page: title, URL, visible text and form controls (labels, selectors, selected/checked state). Password and file values are never returned.',
    params: { maxChars: 'number: maximum page text characters (default 10000)' },
    async run({ maxChars = 10000 }, ctx) {
      return withPage(ctx, async (p) => {
        const details = await p.evaluate((limit) => {
          const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
          const selectorFor = el => {
            if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
            if (el.name) {
              const candidate = `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]` + (el.matches('input[type="radio"]') ? `[value="${CSS.escape(el.value)}"]` : '');
              if (document.querySelectorAll(candidate).length === 1) return candidate;
            }
            const pieces = [];
            for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
              const tag = node.tagName.toLowerCase();
              const siblings = node.parentElement ? [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName) : [node];
              pieces.unshift(`${tag}:nth-of-type(${siblings.indexOf(node) + 1})`);
              const candidate = pieces.join(' > ');
              if (document.querySelectorAll(candidate).length === 1) return candidate;
            }
            return pieces.join(' > ');
          };
          const controls = [...document.querySelectorAll('input,textarea,select,button,[role="radio"],[role="checkbox"]')]
            .filter(visible).slice(0, 100).map((el, i) => {
              const labels = [...(el.labels || [])].map((l) => l.innerText.trim()).filter(Boolean);
              const parentLabel = el.closest('label')?.innerText?.trim();
              const type = String(el.type || el.getAttribute('role') || el.tagName).toLowerCase();
              const item = {
                index: i,
                tag: el.tagName.toLowerCase(),
                type,
                name: el.name || '',
                id: el.id || '',
                selector: selectorFor(el),
                label: labels[0] || parentLabel || el.getAttribute('aria-label') || el.placeholder || '',
                required: Boolean(el.required || el.getAttribute('aria-required') === 'true' || /\*|\bRequired\b/i.test(labels[0] || parentLabel || '')),
                checked: 'checked' in el ? Boolean(el.checked) : el.hasAttribute('aria-checked') ? el.getAttribute('aria-checked') === 'true' : undefined,
                disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
                inViewport: (() => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; })(),
                value: ['password', 'file'].includes(type) ? undefined : (el.value || '').slice(0, 250),
              };
              if (el.tagName === 'SELECT') item.options = [...el.options].slice(0, 50).map((o) => ({ value: o.value, label: o.label, selected: o.selected }));
              if (el.tagName === 'BUTTON') item.text = (el.innerText || '').trim().slice(0, 160);
              return item;
            });
          const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0,100).map(el => ({text:el.innerText.trim().slice(0,160),url:el.href,selector:selectorFor(el)}));
          return { title: document.title, text: (document.body?.innerText || '').slice(0, limit), controls, links };
        }, Math.max(500, Math.min(Number(maxChars) || 10000, 24000)));
        if (stateFor(ctx).blockedRequests.length) details.text += '\nBlocked network writes (owner grant required):\n' + JSON.stringify(stateFor(ctx).blockedRequests);
        audit(ctx, 'inspect', { controls: details.controls.length });
        return { result: `URL: ${p.url()}\nTitle: ${details.title}\n\nVisible text:\n${details.text}\n\nControls (${details.controls.length}, max 100):\n${JSON.stringify(details.controls, null, 2)}\n\nLinks:\n${JSON.stringify(details.links)}`, meta: { url: p.url(), title: details.title, controls: details.controls.length }, summary: `inspected page (${details.controls.length} controls)` };
      });
    },
  }),

  def({
    name: 'browser.click',
    group: 'browser',
    risk: 'write',
    desc: 'Click one page element selected by a Playwright CSS/text selector. By default submit buttons are refused. Owner-authorized origins permit submission; inspect the real confirmation and never repeat an uncertain submission.',
    params: { selector: 'string: Playwright locator selector, e.g. #next or text=Continue', index: 'number: 0-based match index when selector matches more than once' },
    required: ['selector'],
    async run({ selector, index }, ctx) {
      return withPage(ctx, async (p) => {
        const element = await safeClick(p, selector, index, ctx);
        audit(ctx, 'click', { selector, index: index ?? 0, element });
        return { result: `Clicked ${selector}${element.text ? ` (${element.text})` : ''}. URL: ${p.url()}`, meta: { url: p.url(), selector, element }, summary: `clicked ${selector}` };
      });
    },
  }),

  def({
    name: 'browser.fill',
    group: 'browser',
    risk: 'write',
    desc: 'Fill a text, email, number, date or textarea control by selector. Values are not written to the action log. Does not submit the form.',
    params: { selector: 'string: Playwright locator selector, e.g. input[name="email"]', value: 'string: value to enter' },
    required: ['selector', 'value'],
    async run({ selector, value }, ctx) {
      return withPage(ctx, async (p) => {
        const locator = p.locator(selector);
        const count = await locator.count();
        if (count !== 1) throw new Error(count ? `${count} elements matched; use a unique selector` : `no element matched selector: ${selector}`);
        await locator.fill(String(value));
        audit(ctx, 'fill', { selector, valueLength: String(value).length });
        return { result: `Filled ${selector} (${String(value).length} characters). Nothing was submitted.`, meta: { selector, valueLength: String(value).length }, summary: `filled ${selector}` };
      });
    },
  }),

  def({
    name: 'browser.check',
    group: 'browser',
    risk: 'write',
    desc: 'Check or uncheck one checkbox/radio input by selector. For radio groups use the exact option selector; no form submission occurs.',
    params: { selector: 'string: selector for the checkbox or radio input', checked: 'boolean: true to check, false to uncheck (default true)' },
    required: ['selector'],
    async run({ selector, checked = true }, ctx) {
      return withPage(ctx, async (p) => {
        const locator = p.locator(selector);
        if (await locator.count() !== 1) throw new Error(`selector must match exactly one input: ${selector}`);
        const nativeInput = await locator.evaluate((el) => el.matches('input[type="checkbox"], input[type="radio"]'));
        if (nativeInput) {
          await locator.setChecked(Boolean(checked));
        } else {
          const role = await locator.getAttribute('role');
          if (!['checkbox', 'radio'].includes(role)) throw new Error('target must be a checkbox or radio input');
          const current = (await locator.getAttribute('aria-checked')) === 'true';
          if (current !== Boolean(checked)) await locator.click();
        }
        audit(ctx, checked ? 'check' : 'uncheck', { selector });
        return { result: `${checked ? 'Checked' : 'Unchecked'} ${selector}. Nothing was submitted.`, meta: { selector, checked: Boolean(checked) }, summary: `${checked ? 'checked' : 'unchecked'} ${selector}` };
      });
    },
  }),

  def({
    name: 'browser.select',
    group: 'browser',
    risk: 'write',
    desc: 'Choose an option in a <select> element by its value. Does not submit the form.',
    params: { selector: 'string: selector for the select element', value: 'string: option value to choose' },
    required: ['selector', 'value'],
    async run({ selector, value }, ctx) {
      return withPage(ctx, async (p) => {
        const locator = p.locator(selector);
        if (await locator.count() !== 1) throw new Error(`selector must match exactly one select: ${selector}`);
        await locator.selectOption(String(value));
        audit(ctx, 'select', { selector, value });
        return { result: `Selected option ${value} in ${selector}. Nothing was submitted.`, meta: { selector, value }, summary: `selected ${selector}` };
      });
    },
  }),

  def({
    name: 'browser.upload',
    group: 'browser',
    risk: 'write',
    desc: 'Attach a local file to a file input. This only selects the file in the browser; it is not uploaded until the user submits, and submission is blocked.',
    params: { selector: 'string: selector for the file input', filePath: 'string: local absolute or working-directory-relative file path' },
    required: ['selector', 'filePath'],
    async run({ selector, filePath }, ctx) {
      return withPage(ctx, async (p) => {
        const abs = path.resolve(filePath);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error(`file does not exist: ${abs}`);
        const locator = p.locator(selector);
        if (await locator.count() !== 1) throw new Error(`selector must match exactly one file input: ${selector}`);
        await locator.setInputFiles(abs);
        audit(ctx, 'attach-file', { selector, file: path.basename(abs) });
        return { result: `Attached ${path.basename(abs)} in ${selector}. The file was not uploaded and the form was not submitted.`, meta: { selector, file: path.basename(abs) }, summary: `attached ${path.basename(abs)}` };
      });
    },
  }),

  def({
    name: 'browser.press',
    group: 'browser',
    risk: 'write',
    desc: 'Press a keyboard key on the selected element. Enter that would submit a form is intercepted; non-GET requests remain blocked.',
    params: { selector: 'string: Playwright locator selector', key: 'string: key such as Tab, Space, ArrowDown or Enter' },
    required: ['selector', 'key'],
    async run({ selector, key }, ctx) {
      return withPage(ctx, async (p) => {
        const locator = p.locator(selector);
        if (await locator.count() !== 1) throw new Error(`selector must match exactly one element: ${selector}`);
        await locator.press(String(key));
        await p.waitForTimeout(150);
        audit(ctx, 'press', { selector, key });
        return { result: `Pressed ${key} on ${selector}. URL: ${p.url()}`, meta: { selector, key, url: p.url() }, summary: `pressed ${key}` };
      });
    },
  }),

  def({
    name: 'browser.close',
    group: 'browser',
    risk: 'read',
    desc: 'Close the current Playwright browser session. The isolated persistent profile is kept for next time.',
    params: {},
    async run(_args, ctx) {
      return withSession(ctx, async (state) => {
        if (!state.context) return { result: 'No browser session is open.', summary: 'browser already closed' };
        const oldPage = state.page;
        await state.context.close().catch(() => {});
        state.context = null;
        state.page = null;
        state.browserType = null;
        audit(ctx, 'close', {}, oldPage);
        return { result: 'Browser session closed; the local profile was kept. No form was submitted.', summary: 'browser closed' };
      });
    },
  }),
];

export { validateUrl };
