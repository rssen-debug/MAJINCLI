/**
 * MAJIN V4 — the real client, executed.
 *
 * Every other UI test in this repository inspects files: a manifest, a CSP
 * header, a CSS rule. None of them ever ran `app.js`. That is how the dropped
 * conversation id survived for so long: the code looked right and nothing
 * executed it.
 *
 * These tests load the actual `index.html` into jsdom, wire `fetch` to a real
 * MAJIN host, import the actual `app.js`, and drive the UI the way a thumb does.
 * Canvas, speech and service workers are stubbed because jsdom has none — the
 * application code itself is not mocked.
 *
 * Requires jsdom: npm i --no-save jsdom
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { startTestServer } from './helpers.mjs';

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/v4/ui');

let JSDOM;
try {
  ({ JSDOM } = await import('jsdom'));
} catch {
  JSDOM = null;
}

const skip = JSDOM ? false : 'jsdom is not installed (npm i --no-save jsdom)';

/** Stubs for browser APIs jsdom does not implement. */
const PRELUDE = `
  window.__tokens = [];
  HTMLCanvasElement.prototype.getContext = function getContext() {
    const noop = () => {};
    return {
      clearRect: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop,
      save: noop, restore: noop, translate: noop, rotate: noop,
      createRadialGradient: () => ({ addColorStop: noop }),
      set fillStyle(v) {}, get fillStyle() { return ''; },
      set strokeStyle(v) {}, get strokeStyle() { return ''; },
      set globalAlpha(v) {}, get globalAlpha() { return 1; },
      set lineWidth(v) {}, get lineWidth() { return 1; },
      set lineCap(v) {}, get lineCap() { return 'butt'; },
    };
  };
  window.matchMedia = window.matchMedia || ((q) => ({
    matches: false, media: q, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; },
  }));
  if (!window.requestAnimationFrame) window.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  if (!window.cancelAnimationFrame) window.cancelAnimationFrame = (id) => clearTimeout(id);
  window.speechSynthesis = { cancel() {}, speak(u) { window.__tokens.push('speak'); setTimeout(() => u.onend && u.onend(), 0); }, getVoices: () => [] };
  window.SpeechSynthesisUtterance = function SpeechSynthesisUtterance(text) { this.text = text; };
  if (!navigator.serviceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', { value: { register: () => Promise.resolve() }, configurable: true });
  }
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
`;

/**
 * Boot the real app against a real host.
 *
 * The five browser modules are concatenated in dependency order with their
 * `import`/`export` keywords stripped, then evaluated in the jsdom window. That
 * is the same source that ships to the phone — no copy, no rewrite — while
 * avoiding a bundler and a build step in the test.
 */
const MODULE_ORDER = ['session.js', 'strings.js', 'voice.js', 'spirit.js', 'app.js'];

function clientBundle() {
  const parts = [];
  for (const name of MODULE_ORDER) {
    const code = fs.readFileSync(path.join(UI, name), 'utf8');
    const stripped = code
      .split('\n')
      .filter((line) => !/^\s*import\s/.test(line))
      .map((line) => line.replace(/^export\s+(const|let|function|class|async function)/, '$1'))
      .filter((line) => !/^\s*export\s+default\s/.test(line))
      .join('\n');
    parts.push(`/* ---- ${name} ---- */\n${stripped}`);
  }
  return parts.join('\n');
}

async function bootApp() {
  const server = await startTestServer();
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: `${server.base}/`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.eval(PRELUDE);

  // Cookies: jsdom's own fetch is not used; the session cookie is forwarded here.
  // `hooks` lets a test break the network or expire the session on purpose.
  let cookie = '';
  const hooks = { dropChatOnce: false, expireSession: false, dropEveryChat: false, dropStreamAfterOpen: false };
  const realFetch = globalThis.fetch;
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const absolute = url.startsWith('http') ? url : `${server.base}${url}`;
    const isChat = url.startsWith('/api/chat') && !url.startsWith('/api/chat/stream');

    if (isChat && (hooks.dropChatOnce || hooks.dropEveryChat)) {
      hooks.dropChatOnce = false; // exactly one failure, like a network blip
      throw new TypeError('Failed to fetch');
    }

    const headers = { ...(init.headers || {}) };
    if (cookie) headers.cookie = cookie;
    if (hooks.expireSession && isChat) headers.cookie = 'majin_v4=expired.invalid';
    const res = await realFetch(absolute, { ...init, headers });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];

    // Drop the stream *after* the `open` event: this is the real-world case the
    // journal exists for, because by then the client knows the turn id and can
    // reattach. Failing before `open` can only ever be an error message.
    if (isChat && hooks.dropStreamAfterOpen && res.body) {
      hooks.dropStreamAfterOpen = false;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let seenOpen = false;
      const patched = new ReadableStream({
        async pull(controller) {
          const { value, done } = await reader.read();
          if (done) {
            controller.close();
            return;
          }
          const text = decoder.decode(value, { stream: true });
          controller.enqueue(value);
          if (!seenOpen && text.includes('event: open')) {
            seenOpen = true;
            // The next read behaves like a radio that went away.
            controller.error(new TypeError('network lost'));
          }
        },
      });
      return new Response(patched, { status: res.status, headers: res.headers });
    }

    return res;
  };

  // jsdom already provides most globals; only fill genuine gaps, because several
  // window properties are getter-only and assigning throws.
  const fill = (name, value) => {
    if (window[name] != null) return;
    try {
      Object.defineProperty(window, name, { value, configurable: true, writable: true });
    } catch { /* frozen in this jsdom: the app can live without it */ }
  };
  fill('AbortController', globalThis.AbortController);
  fill('TextDecoder', globalThis.TextDecoder);
  fill('Headers', globalThis.Headers);
  fill('Request', globalThis.Request);
  fill('Response', globalThis.Response);

  const errors = [];
  window.addEventListener('error', (e) => errors.push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason?.message || e.reason)));

  window.eval(clientBundle());

  return {
    dom,
    window,
    document: window.document,
    server,
    errors,
    hooks,
    get cookie() {
      return cookie;
    },
    async close() {
      window.close();
      await server.close();
    },
  };
}

/** Wait until `fn()` is truthy, or fail with what the DOM actually shows. */
async function until(fn, { timeoutMs = 8000, label = 'condition', dom = () => '' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}${dom() ? `\n--- dom ---\n${dom()}` : ''}`);
}

const visible = (el) => el && !el.hidden && el.style.display !== 'none';

test('client: the real app boots, asks for pairing and shows no console error', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), {
      label: 'the pairing gate',
      dom: () => app.document.body.innerHTML.slice(0, 600),
    });
    assert.equal(app.document.querySelector('#gate').hidden, false);
    assert.equal(app.errors.length, 0, `uncaught errors: ${app.errors.join('; ')}`);
  } finally {
    await app.close();
  }
});

test('client: entering the pairing code opens the app and clears the gate', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
    const input = app.document.querySelector('#gate-code');
    input.value = app.server.context.pairingFresh;
    app.document.querySelector('#gate-form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));

    await until(() => app.document.querySelector('#gate').hidden === true, { label: 'the gate to close' });
    await until(() => app.document.querySelector('#model-label').textContent !== 'ansluter…', { label: 'state to load' });
    assert.equal(app.document.querySelector('#model-label').textContent, 'demo');
  } finally {
    await app.close();
  }
});

test('client: a message typed and sent renders the answer and a verified tool card', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
    app.document.querySelector('#gate-code').value = app.server.context.pairingFresh;
    app.document.querySelector('#gate-form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => app.document.querySelector('#gate').hidden, { label: 'paired' });

    const input = app.document.querySelector('#input');
    input.value = 'Skriv filen dom.txt med innehåll: hej från DOM';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    assert.equal(app.document.querySelector('#send-btn').disabled, false, 'send enabled by typing');

    app.document.querySelector('#composer').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));

    await until(() => app.document.querySelector('.tool[data-state="verified"]'), {
      label: 'a verified tool card',
      dom: () => app.document.querySelector('#thread').innerHTML.slice(0, 800),
    });
    await until(() => {
      const bodies = app.document.querySelectorAll('.msg[data-role="assistant"] .msg-body');
      return bodies.length && bodies[bodies.length - 1].textContent.trim().length > 10;
    }, { label: 'the assistant answer' });

    // The conversation is real: the file exists and one conversation was used.
    const fsMod = await import('node:fs');
    assert.ok(fsMod.existsSync(path.join(app.server.home, 'workspace', 'dom.txt')));
    assert.equal(app.document.querySelectorAll('.msg[data-role="user"]').length, 1);
  } finally {
    await app.close();
  }
});

test('client: two messages in a row stay in one conversation (the regression test, in a real DOM)', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
    app.document.querySelector('#gate-code').value = app.server.context.pairingFresh;
    app.document.querySelector('#gate-form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => app.document.querySelector('#gate').hidden, { label: 'paired' });

    const send = async (text) => {
      const input = app.document.querySelector('#input');
      input.value = text;
      input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
      app.document.querySelector('#composer').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
      await until(() => app.document.querySelector('#stop-btn').hidden === true, { label: 'turn to finish', timeoutMs: 15_000 });
    };

    await send('Skriv filen a.txt med innehåll: ett');
    await send('Lista filerna i arbetsytan');

    const res = await app.window.fetch('/api/conversations');
    const data = await res.json();
    assert.equal(data.conversations.length, 1, 'both messages landed in ONE conversation');
    assert.equal(data.conversations[0].messages, 4, 'two user + two assistant messages');
  } finally {
    await app.close();
  }
});

test('client: the composer disables send while a turn is running and restores it after', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
    app.document.querySelector('#gate-code').value = app.server.context.pairingFresh;
    app.document.querySelector('#gate-form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => app.document.querySelector('#gate').hidden, { label: 'paired' });

    const input = app.document.querySelector('#input');
    input.value = 'Skriv filen busy.txt med innehåll: x';
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.document.querySelector('#composer').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));

    assert.equal(app.document.querySelector('#stop-btn').hidden, false, 'stop is offered while running');
    await until(() => app.document.querySelector('#stop-btn').hidden === true, { label: 'turn to finish', timeoutMs: 15_000 });
    assert.equal(app.document.querySelector('#send-btn').hidden, false, 'send comes back');
    assert.equal(input.value, '', 'the composer was cleared');
  } finally {
    await app.close();
  }
});

/* ------------------------------------------------------- failure paths -- */

/** Pair the app and return a helper that sends one message. */
async function paired(app) {
  await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
  app.document.querySelector('#gate-code').value = app.server.context.pairingFresh;
  app.document.querySelector('#gate-form').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => app.document.querySelector('#gate').hidden, { label: 'paired' });
  return async (text) => {
    const input = app.document.querySelector('#input');
    input.value = text;
    input.dispatchEvent(new app.window.Event('input', { bubbles: true }));
    app.document.querySelector('#composer').dispatchEvent(new app.window.Event('submit', { bubbles: true, cancelable: true }));
  };
}

test('client: a network failure mid-send is reported, and the UI does not hang', { skip }, async () => {
  const app = await bootApp();
  try {
    const send = await paired(app);
    app.hooks.dropEveryChat = true; // the host is unreachable
    await send('Skriv filen nät.txt med innehåll: x');

    await until(() => {
      const bodies = [...app.document.querySelectorAll('.msg[data-role="assistant"] .msg-body')];
      return bodies.some((b) => /nådde inte värden|host/i.test(b.textContent));
    }, { label: 'an honest network error', timeoutMs: 12_000, dom: () => app.document.querySelector('#thread').innerHTML.slice(0, 700) });

    // the composer must be usable again, not stuck in "streaming"
    await until(() => app.document.querySelector('#stop-btn').hidden === true, { label: 'the turn to end', timeoutMs: 12_000 });
    assert.equal(app.document.querySelector('#send-btn').hidden, false);
    assert.equal(app.document.querySelector('#composer').dataset.streaming, 'false');
  } finally {
    await app.close();
  }
});

test('client: an expired session re-opens the pairing gate instead of failing silently', { skip }, async () => {
  const app = await bootApp();
  try {
    const send = await paired(app);
    app.hooks.expireSession = true;
    await send('Skriv filen utgangen.txt med innehåll: x');

    await until(() => app.document.querySelector('#gate').hidden === false, {
      label: 'the gate to reappear',
      timeoutMs: 12_000,
      dom: () => app.document.body.innerHTML.slice(0, 500),
    });
    assert.match(app.document.querySelector('#gate-error').textContent, /gått ut|anslut/i);
  } finally {
    await app.close();
  }
});

test('client: a connection lost after `open` is picked back up, and the answer still arrives', { skip }, async () => {
  const app = await bootApp();
  try {
    const send = await paired(app);
    // The turn starts, the client learns turnId, then the stream dies. This is
    // the case the turn journal exists for.
    app.hooks.dropStreamAfterOpen = true;
    await send('Skriv filen aterkomst.txt med innehåll: kvar');

    await until(() => app.document.querySelector('#stop-btn').hidden === true, {
      label: 'the turn to end',
      timeoutMs: 25_000,
      dom: () => app.document.querySelector('#thread').innerHTML.slice(0, 800),
    });

    const bodies = [...app.document.querySelectorAll('.msg[data-role="assistant"] .msg-body')].map((b) => b.textContent);
    assert.ok(bodies.length > 0, 'an assistant message exists');
    assert.ok(
      bodies.some((b) => /aterkomst\.txt/.test(b)),
      `the answer must be the real one from the host, got: ${JSON.stringify(bodies)}`,
    );
    assert.ok(
      !bodies.some((b) => /nådde inte värden/.test(b)),
      'a reconnectable drop must not be reported as a host failure',
    );
    assert.equal(app.document.querySelector('#send-btn').hidden, false, 'composer is usable');
    // and the work exists on the host exactly once
    const fsMod = await import('node:fs');
    const ws = path.join(app.server.home, 'workspace');
    assert.deepEqual(fsMod.readdirSync(ws).filter((f) => f.startsWith('aterkomst')), ['aterkomst.txt']);
  } finally {
    await app.close();
  }
});

test('client: the offline bar is shown when the device reports no network', { skip }, async () => {
  const app = await bootApp();
  try {
    await until(() => visible(app.document.querySelector('#gate')), { label: 'gate' });
    app.window.dispatchEvent(new app.window.Event('offline'));
    assert.equal(app.document.querySelector('#offline-bar').hidden, false, 'the bar is visible');
    app.window.dispatchEvent(new app.window.Event('online'));
    assert.equal(app.document.querySelector('#offline-bar').hidden, true, 'and it clears again');
  } finally {
    await app.close();
  }
});
