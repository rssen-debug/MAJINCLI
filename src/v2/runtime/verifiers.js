/**
 * V2 verifier registry (master brief section 22).
 *
 * The executor asks "how do I do this"; the verifier asks "what evidence proves
 * it happened". Each verifier is an independent check that returns
 * { verified:boolean, evidence } or { verified:false, error:{cls,...} }.
 * Kinds shipped now: file, http, pixel, dom (dom degrades honestly when
 * Playwright is not installed — registry never fabricates a pass).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/**
 * kind='file' — a target file must exist, and optionally match size/hash/contains.
 * spec: { path, minBytes?, hash?, contains? }  (hash = sha256 hex of exact bytes)
 */
export function verifyFile(spec) {
  const p = spec.path;
  if (!p || !fs.existsSync(p)) {
    return { verified: false, error: { cls: 'DEPENDENCY_MISSING', message: `file missing: ${p}` } };
  }
  const buf = fs.readFileSync(p);
  if (spec.minBytes != null && buf.length < spec.minBytes) {
    return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: `size ${buf.length} < minBytes ${spec.minBytes}` } };
  }
  let hash = null;
  if (spec.hash != null) {
    hash = sha256(buf);
    if (hash !== spec.hash.toLowerCase()) {
      return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: 'hash mismatch' } };
    }
  }
  if (spec.contains != null && !buf.toString('utf8').includes(spec.contains)) {
    return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: 'expected content absent' } };
  }
  return { verified: true, evidence: { kind: 'file', path: p, bytes: buf.length, sha256: hash || sha256(buf) } };
}

/**
 * kind='http' — URL must answer with expected status (default 200), and may
 * optionally require text in the response body. Verification is read-only:
 * only GET/HEAD are accepted. Native fetch, zero deps, hard timeout so the
 * kernel never hangs a goal here.
 * spec: { url, status?, method?, contains? }
 */
export async function verifyHttp(spec, { timeoutMs = 5000 } = {}) {
  const url = spec?.url;
  if (!url) return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier requires url' } };
  let parsed;
  try { parsed = new URL(String(url)); } catch {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier requires a valid URL' } };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier only supports http(s) URLs' } };
  }
  if (parsed.username || parsed.password) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier URL must not embed credentials' } };
  }
  const method = String(spec.method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier is read-only and only supports GET/HEAD' } };
  }
  if (method === 'HEAD' && spec.contains != null) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'http verifier contains check requires GET' } };
  }
  const expect = spec.status || 200;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(parsed, { method, signal: ctrl.signal });
    if (res.status !== expect) {
      return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: `status ${res.status} != ${expect}` } };
    }
    const evidence = { kind: 'http', url: parsed.toString(), status: res.status, method };
    if (spec.contains != null) {
      const body = Buffer.from(await res.arrayBuffer());
      evidence.bytes = body.length;
      evidence.sha256 = sha256(body);
      if (!body.toString('utf8').includes(String(spec.contains))) {
        return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: 'expected content absent' } };
      }
      evidence.contains = String(spec.contains);
    }
    return { verified: true, evidence };
  } catch (err) {
    const cls = err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_FAILURE';
    return { verified: false, error: { cls, message: String(err.message || err) } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * kind='pixel' — PNG must contain expected color inside a region (W12-style proof).
 * spec: { pngPath, region: {x,y,w,h} (optional: full image), rgba: [r,g,b,a?], tolerance?, minHits? }
 */
export function verifyPixel(spec) {
  if (!spec.pngPath || !fs.existsSync(spec.pngPath)) {
    return { verified: false, error: { cls: 'DEPENDENCY_MISSING', message: `png missing: ${spec.pngPath}` } };
  }
  if (!Array.isArray(spec.rgba) || spec.rgba.length < 3) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'pixel verifier needs rgba [r,g,b]' } };
  }
  let png;
  try {
    png = PNG.sync.read(fs.readFileSync(spec.pngPath));
  } catch (err) {
    return { verified: false, error: { cls: 'INVALID_TOOL_OUTPUT', message: `png decode failed: ${err.message}` } };
  }
  const [rT, gT, bT, aT = 255] = spec.rgba;
  const tol = spec.tolerance == null ? 8 : spec.tolerance;
  const reg = spec.region || { x: 0, y: 0, w: png.width, h: png.height };
  const minHits = spec.minHits == null ? 1 : spec.minHits;
  let hits = 0;
  for (let y = reg.y; y < Math.min(reg.y + reg.h, png.height); y += 1) {
    for (let x = reg.x; x < Math.min(reg.x + reg.w, png.width); x += 1) {
      const i = (png.width * y + x) << 2;
      const r = png.data[i]; const g = png.data[i + 1]; const b = png.data[i + 2]; const a = png.data[i + 3];
      if (Math.abs(r - rT) <= tol && Math.abs(g - gT) <= tol && Math.abs(b - bT) <= tol && Math.abs(a - aT) <= tol) hits += 1;
    }
  }
  if (hits < minHits) {
    return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: `${hits}/${minHits} matching pixels in region` } };
  }
  return { verified: true, evidence: { kind: 'pixel', pngPath: spec.pngPath, region: reg, hits, width: png.width, height: png.height } };
}

/**
 * kind='dom' — Playwright-backed DOM observation (real browser evidence).
 * Degrades honestly when Playwright isn't installed: DEPENDENCY_MISSING,
 * never a fabricated pass. Accepts either the full `playwright` package or
 * `playwright-core` with a system browser supplied via executablePath.
 * spec: { url, selector, expectText?|contains?, executablePath? }
 */
export async function verifyDom(spec, { timeoutMs = 15000, launchTimeoutMs = 45000, executablePath = spec?.executablePath } = {}) {
  if (!spec?.url || !spec?.selector) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'dom verifier requires url and selector' } };
  }
  let parsed;
  try { parsed = new URL(String(spec.url)); } catch {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'dom verifier requires a valid URL' } };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'dom verifier only supports http(s) URLs' } };
  }
  if (parsed.username || parsed.password) {
    return { verified: false, error: { cls: 'UNKNOWN', message: 'dom verifier URL must not embed credentials' } };
  }
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    try {
      ({ chromium } = await import('playwright-core'));
    } catch {
      return { verified: false, error: { cls: 'DEPENDENCY_MISSING', message: 'playwright not installed — dom verification unavailable' } };
    }
  }
  if (process.platform === 'win32') {
    // Same Windows profile guard as the browser tools: Edge/Chromium cannot
    // resolve LocalAppData under an empty sandboxed %USERPROFILE% and then
    // refuses remote debugging before Playwright can connect.
    const userProfile = process.env.USERPROFILE || os.homedir();
    if (userProfile) {
      for (const appDataDir of [
        path.join(userProfile, 'AppData', 'Local'),
        path.join(userProfile, 'AppData', 'Roaming'),
      ]) {
        try { fs.mkdirSync(appDataDir, { recursive: true }); } catch { /* launch will surface the real error */ }
      }
    }
  }
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      timeout: launchTimeoutMs,
      ...(executablePath ? { executablePath } : {}),
    });
    const page = await browser.newPage();
    await page.goto(parsed.toString(), { waitUntil: 'load', timeout: timeoutMs });
    const el = page.locator(spec.selector).first();
    const visible = await el.isVisible({ timeout: 5000 }).catch(() => false);
    if (!visible) {
      return { verified: false, error: { cls: 'ELEMENT_NOT_FOUND', message: `selector not visible: ${spec.selector}` } };
    }
    const expectedText = spec.expectText ?? spec.contains ?? spec.text;
    let text = null;
    if (expectedText != null) {
      text = await el.textContent();
      if (!(text || '').includes(String(expectedText))) {
        return { verified: false, error: { cls: 'VERIFICATION_FAILURE', message: 'expected text absent' } };
      }
    }
    return { verified: true, evidence: { kind: 'dom', url: parsed.toString(), selector: spec.selector, text: text == null ? null : text.slice(0, 80) } };
  } catch (err) {
    const message = String(err.message || err);
    const cls = /Executable doesn't exist|browser.*not found|Please run.*playwright install/i.test(message)
      ? 'DEPENDENCY_MISSING'
      : 'UNKNOWN';
    return { verified: false, error: { cls, message: message.slice(0, 2000) } };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

export const verifierRegistry = { file: verifyFile, http: verifyHttp, pixel: verifyPixel, dom: verifyDom };

export async function runVerifier(kind, spec, o) {
  const fn = verifierRegistry[kind];
  if (!fn) throw new Error(`unknown verifier kind: ${kind}`);
  return fn(spec, o);
}
