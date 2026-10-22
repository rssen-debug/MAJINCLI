import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { startTestServer } from './helpers.mjs';
import {
  detectVoiceSupport,
  recognitionLang,
  shouldAutoSend,
  speechText,
  voiceErrorMessage,
} from '../../src/v4/ui/voice.js';

const UI = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../src/v4/ui');

function pngSize(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.slice(1, 4).toString('ascii'), 'PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('pwa: manifest is valid and installable', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(UI, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.short_name, 'MAJIN');
  assert.ok(manifest.name.length > 3);
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);
  const sizes = manifest.icons.map((i) => i.sizes);
  assert.ok(sizes.includes('192x192'));
  assert.ok(sizes.includes('512x512'));
  assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
});

test('pwa: every declared icon exists with the declared pixel size', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(UI, 'manifest.webmanifest'), 'utf8'));
  for (const icon of manifest.icons) {
    const file = path.join(UI, icon.src.replace(/^\//, ''));
    assert.ok(fs.existsSync(file), icon.src);
    const { width, height } = pngSize(file);
    assert.equal(`${width}x${height}`, icon.sizes);
  }
});

test('pwa: the service worker never touches API traffic', () => {
  const sw = fs.readFileSync(path.join(UI, 'sw.js'), 'utf8');
  assert.ok(sw.includes("url.pathname.startsWith('/api/')"));
  assert.ok(sw.includes('if (request.method !== \'GET\') return;'));
  assert.ok(!/caches\.put\([^)]*api/.test(sw));
});

test('mobile: viewport, safe areas and keyboard support are declared', () => {
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /interactive-widget=resizes-content/);
  assert.match(html, /theme-color/);
  assert.match(html, /apple-mobile-web-app-capable/);
  assert.match(html, /rel="manifest"/);
  const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8');
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /orientation: landscape/);
  assert.match(css, /min-width: 720px/);
});

test('accessibility: primary controls have labels, live regions and 42px targets', () => {
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  assert.match(html, /id="mic-btn" aria-label="Tala"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-live="assertive"/);
  assert.match(html, /role="status"/);
  assert.match(html, /id="input"[^>]*enterkeyhint="send"/);
  const css = fs.readFileSync(path.join(UI, 'app.css'), 'utf8');
  assert.match(css, /\.mic, \.send, \.stop \{[^}]*width: 42px/);
  assert.match(css, /:focus-visible/);
});

test('security: the UI ships no inline script and no secrets', () => {
  const html = fs.readFileSync(path.join(UI, 'index.html'), 'utf8');
  assert.ok(!/<script(?![^>]*src=)/i.test(html), 'no inline <script>');
  assert.ok(!/on(click|load|error)=/i.test(html), 'no inline handlers');
  for (const f of ['app.js', 'spirit.js', 'voice.js', 'sw.js', 'strings.js', 'session.js']) {
    const src = fs.readFileSync(path.join(UI, f), 'utf8');
    assert.ok(!/sk-[a-zA-Z0-9]{16,}/.test(src), `${f} has no key`);
    assert.ok(!/ghp_[a-zA-Z0-9]{20,}/.test(src), `${f} has no token`);
  }
});

test('ui: every asset is served with the right content type', async () => {
  const s = await startTestServer();
  try {
    const expected = {
      '/': 'text/html',
      '/app.css': 'text/css',
      '/app.js': 'text/javascript',
      '/spirit.js': 'text/javascript',
      '/voice.js': 'text/javascript',
      '/strings.js': 'text/javascript',
      '/session.js': 'text/javascript',
      '/manifest.webmanifest': 'application/manifest+json',
      '/sw.js': 'text/javascript',
      '/icons/icon-192.png': 'image/png',
      '/icons/icon-512.png': 'image/png',
      '/icons/maskable-512.png': 'image/png',
    };
    for (const [route, type] of Object.entries(expected)) {
      const res = await fetch(`${s.base}${route}`);
      assert.equal(res.status, 200, route);
      assert.ok((res.headers.get('content-type') || '').startsWith(type), `${route}: ${res.headers.get('content-type')}`);
    }
  } finally {
    await s.close();
  }
});

test('voice: capability detection is honest on every browser shape', () => {
  assert.deepEqual(detectVoiceSupport({}), { recognition: false, synthesis: false, mode: 'text-only', continuous: false, bargeIn: false });
  const withRec = detectVoiceSupport({ SpeechRecognition: class {} });
  assert.equal(withRec.mode, 'tap-to-talk');
  assert.equal(withRec.continuous, false, 'never claim always-listening');
  assert.equal(withRec.bargeIn, false, 'never claim server-side barge-in');
  const webkit = detectVoiceSupport({ webkitSpeechRecognition: class {}, speechSynthesis: {}, SpeechSynthesisUtterance: class {} });
  assert.equal(webkit.recognition, true);
  assert.equal(webkit.synthesis, true);
});

test('voice: language follows the device with a Swedish default', () => {
  assert.equal(recognitionLang('sv-SE'), 'sv-SE');
  assert.equal(recognitionLang('en-GB'), 'en-US');
  assert.equal(recognitionLang('de-DE'), 'sv-SE');
  assert.equal(recognitionLang(''), 'sv-SE');
  assert.equal(recognitionLang(undefined), 'sv-SE');
});

test('voice: permission errors are explained, not swallowed', () => {
  assert.match(voiceErrorMessage('not-allowed'), /blockerad/);
  assert.match(voiceErrorMessage('service-not-allowed'), /blockerad/);
  assert.match(voiceErrorMessage('no-speech'), /hörde inget/);
  assert.match(voiceErrorMessage('audio-capture'), /mikrofon/i);
  assert.match(voiceErrorMessage('network'), /nätverk/);
  assert.equal(voiceErrorMessage('aborted'), '');
});

test('voice: auto-send only on a final transcript outside an active turn', () => {
  assert.equal(shouldAutoSend({ finalTranscript: 'hej', autosend: true, streaming: false }), true);
  assert.equal(shouldAutoSend({ finalTranscript: '', autosend: true, streaming: false }), false);
  assert.equal(shouldAutoSend({ finalTranscript: 'hej', autosend: false, streaming: false }), false);
  assert.equal(shouldAutoSend({ finalTranscript: 'hej', autosend: true, streaming: true }), false);
});

test('voice: speech text is stripped of markup and bounded', () => {
  assert.equal(speechText('**Klart** `nu`'), 'Klart nu');
  assert.equal(speechText('   '), '');
  assert.equal(speechText('a'.repeat(2000)).length, 1200);
});
