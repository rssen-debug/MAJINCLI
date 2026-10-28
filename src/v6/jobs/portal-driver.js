/**
 * MAJIN V6 — minimal Playwright driver for the portal submit adapter.
 *
 * The adapter only uses this small surface, so tests can substitute a fake
 * driver with the same methods and never launch Chromium.
 */
import fs from 'node:fs';
import path from 'node:path';

function chromeExecutablePath() {
  if (process.env.MAJIN_BROWSER_EXECUTABLE && fs.existsSync(process.env.MAJIN_BROWSER_EXECUTABLE)) {
    return process.env.MAJIN_BROWSER_EXECUTABLE;
  }
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => fs.existsSync(p)) || undefined;
}

export async function createPlaywrightDriver({ log = null } = {}) {
  const { chromium } = await import('playwright-core');
  const executablePath = chromeExecutablePath();
  const context = await chromium.launchPersistentContext(
    path.join(process.env.TEMP || '/tmp', 'majin-portal-driver-profile'),
    { headless: process.env.MAJIN_PORTAL_HEADLESS !== 'false', executablePath, viewport: { width: 1440, height: 1000 } },
  );
  let page = context.pages()[0] || await context.newPage();
  const noop = (line) => { try { log?.append?.('portal.driver', { line }); } catch { /* log is optional */ } };

  const driver = {
    async open(url) {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      return true;
    },
    async text() {
      try { return await page.evaluate(() => (document.body ? document.body.innerText : '')); } catch { return ''; }
    },
    async url() {
      return page.url();
    },
    async fill(selector, value) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.fill(String(value));
        return (await locator.inputValue()) === String(value);
      } catch { return false; }
    },
    async check(selector) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.check({ force: true });
        return true;
      } catch { return false; }
    },
    async select(selector, value) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.selectOption(String(value));
        return true;
      } catch { return false; }
    },
    async upload(selector, filePath) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.setInputFiles(filePath);
        const expected = fs.statSync(filePath);
        return await locator.evaluate((el, file) => el.files?.length === 1 && el.files[0].name === file.name && el.files[0].size === file.size, { name: path.basename(filePath), size: expected.size });
      } catch { return false; }
    },
    async click(selector) {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.click({ timeout: 8000 });
        return true;
    },
    async fillNth(selector, index, value) {
      try {
        const locator = page.locator(selector).nth(Math.max(0, Number(index) || 0));
        if ((await locator.count()) === 0) return false;
        await locator.fill(String(value));
        return true;
      } catch { return false; }
    },
    async checkNth(selector, index) {
      try {
        const locator = page.locator(selector).nth(Math.max(0, Number(index) || 0));
        if ((await locator.count()) === 0) return false;
        await locator.check({ force: true });
        return true;
      } catch { return false; }
    },
    async uploadNth(selector, index, filePath) {
      try {
        const locator = page.locator(selector).nth(Math.max(0, Number(index) || 0));
        if ((await locator.count()) === 0) return false;
        await locator.setInputFiles(filePath);
        const expected = fs.statSync(filePath);
        return await locator.evaluate((el, file) => el.files?.length === 1 && el.files[0].name === file.name && el.files[0].size === file.size, { name: path.basename(filePath), size: expected.size });
      } catch { return false; }
    },
    async selectLabel(selector, label) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.selectOption({ label: String(label) });
        return true;
      } catch { return false; }
    },
    async selectValue(selector, value) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) === 0) return false;
        await locator.selectOption(String(value));
        return true;
      } catch { return false; }
    },
    async wait(ms) {
      await page.waitForTimeout(Math.max(0, Number(ms) || 0));
    },
    async validateForm() {
      return page.locator('form').evaluateAll(forms => {
        const form = forms.find(f => f.querySelector('input[type="file"]'));
        if (!form || !form.checkValidity()) return false;
        return [...form.querySelectorAll('input, textarea, select')].every(el => {
          if (el.disabled || ['hidden', 'submit', 'button', 'search'].includes(el.type)) return true;
          const labels = [...(el.labels || [])].map(l => l.innerText).join(' ');
          const required = el.required || el.getAttribute('aria-required') === 'true' || /\*|\bRequired\b/i.test(labels);
          if (!required) return true;
          if (el.type === 'checkbox') return el.checked;
          if (el.type === 'radio') return [...form.elements].some(other => other.name === el.name && other.checked);
          if (el.type === 'file') return el.files?.length > 0;
          return Boolean(el.value?.trim());
        });
      });
    },
    async inspectForm() {
      return page.locator('input, textarea, select, button[type="submit"]').evaluateAll(elements => elements.map(el => ({
        tag: el.tagName.toLowerCase(), type: el.type, id: el.id, name: el.name,
        label: [...(el.labels || [])].map(l => l.innerText).join(' '),
        required: el.required, text: el.tagName === 'BUTTON' ? el.innerText : undefined,
        options: el.tagName === 'SELECT' ? [...el.options].map(o => ({ value: o.value, text: o.text })) : undefined,
      })));
    },
    async inspectLinks() {
      return page.locator('a[href]').evaluateAll(elements => elements.map(el => ({ text: el.innerText, href: el.href })));
    },
    async inspectFrames() {
      return Promise.all(page.frames().map(async frame => ({ url: frame.url(), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 18000) })));
    },
    async screenshot(file) {
      await page.screenshot({ path: file, fullPage: true });
      return file;
    },
    async close() {
      await context.close().catch(() => {});
    },
  };
  return driver;
}
