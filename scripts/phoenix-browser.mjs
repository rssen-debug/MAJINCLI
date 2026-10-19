/** Real browser acceptance against a disposable MAJIN server. No paid calls. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-ui-'));
const port = 19000 + Math.floor(Math.random() * 1000);
const output = process.env.MAJIN_UI_OUTPUT || path.resolve('work/ui-evidence');
fs.mkdirSync(output, { recursive: true });
const child = spawn(process.execPath, ['src/cli/majin.js', '_serve', '--no-window', '--no-channels'], {
  env: { ...process.env, MAJIN_HOME: home, MAJIN_PORT: String(port), MAJIN_NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
try {
  let ready = false;
  child.stdout.on('data', d => { if (String(d).includes('listening on')) ready = true; });
  for (let i = 0; !ready && i < 100; i++) await new Promise(r => setTimeout(r, 100));
  assert.ok(ready, 'server starts');
  const cfg = JSON.parse(fs.readFileSync(path.join(home, 'config.json'), 'utf8'));
  const token = cfg.server.token;
  browser = await chromium.launch({ headless: true, ...(process.env.MAJIN_UI_BROWSER ? { channel: process.env.MAJIN_UI_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?t=${token}`);
  await page.waitForFunction(() => window.MAJIN_ONBOARD && document.querySelector('#home'));
  if (await page.locator('#ob-skip').isVisible()) await page.locator('#ob-skip').click();
  assert.equal(await page.evaluate(() => window.__MAJIN_TOKEN__), token, 'server does not rewrite variable names');
  await page.screenshot({ path: path.join(output, 'phoenix-home.png') });
  const catalog = Array.from({ length: 1200 }, (_, i) => ({ id: `vendor/model-${i}:free`, name: `Model ${String(i).padStart(4, '0')}`, free: i % 2 === 0, input: i % 2, output: i % 2, context: (i + 1) * 1000, tools: true }));
  await page.route('**/api/models?**', r => r.fulfill({ json: { ok: true, catalog, models: catalog.map(m => m.id) } }));
  await page.locator('#c-model').click();
  await page.waitForFunction(() => document.querySelector('.explorer-count')?.textContent.includes('1200'));
  assert.equal(await page.locator('.ob-model').count(), 60);
  await page.getByRole('button', { name: 'Show more models' }).click();
  assert.equal(await page.locator('.ob-model').count(), 120);
  await page.getByRole('button', { name: 'Free only', exact: true }).click();
  assert.match(await page.locator('.explorer-count').textContent(), /600 of 1200/);
  await page.getByRole('textbox', { name: 'Search models' }).fill('model-1198');
  assert.equal(await page.locator('.ob-model').count(), 1);
  await page.locator('.ob-model').click();
  await page.waitForFunction(() => document.querySelector('#modeldrop').hidden);
  const saved = await page.evaluate(() => window.MAJIN_ONBOARD.api('/config'));
  assert.ok(Object.values(saved.config.models.routes).every(r => r.endsWith('/vendor/model-1198:free')), 'exact provider IDs saved for every route');
  await page.locator('#c-model').click();
  await page.waitForFunction(() => document.querySelector('.explorer-count')?.textContent.includes('1200'));
  await page.getByRole('button', { name: 'Free only', exact: true }).click();
  await page.screenshot({ path: path.join(output, 'phoenix-models.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#c-model').evaluate(n => n === document.activeElement), true);
  const stream = events => events.map(([type, data]) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  for (const status of [400, 401, 402, 404, 429, 500]) {
    await page.route('**/api/chat?**', r => r.fulfill({ contentType: 'text/event-stream', body: stream([
      ['error', { message: `${status}: deepseek/deepseek-flash is not a valid model ID` }],
      ['delta', { text: 'Late content must not replace the error' }],
      ['answer', { type: 'answer', text: 'False success' }], ['done', { ok: false }],
    ]) }));
    await page.locator('#input').fill('hi'); await page.locator('#send').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Request failed'));
    await page.waitForFunction(() => document.querySelector('#send').textContent.includes('Send'));
    assert.equal(await page.locator('#input').inputValue(), 'hi');
    assert.equal(await page.getByText('False success', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Late content must not replace the error', { exact: true }).count(), 0);
    assert.equal(await page.locator('#imagine .core-label').textContent(), 'something went wrong');
    await page.unroute('**/api/chat?**');
  }
  await page.screenshot({ path: path.join(output, 'phoenix-error.png') });
  assert.equal(await page.locator('.msg.err').count(), 6, 'one error card per failed request');
  await page.route('**/api/chat?**', r => r.fulfill({ contentType: 'text/event-stream', body: stream([
    ['route', { job: 'chat', model: 'test/model' }], ['delta', { text: 'Hello. ' }], ['delta', { text: 'Ready to create.' }],
    ['answer', { text: 'Hello. Ready to create.' }], ['done', { ok: true }],
  ]) }));
  await page.locator('#input').fill('hello'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Ready');
  assert.equal(await page.getByText('Hello. Ready to create.', { exact: true }).count(), 1);
  assert.equal(await page.locator('.msg.sys').count(), 0, 'routing does not spam transcript');
  await page.screenshot({ path: path.join(output, 'phoenix-chat.png') });
  await page.unroute('**/api/chat?**');
  await page.route('**/api/chat?**', r => r.fulfill({ contentType: 'text/event-stream', body: stream([
    ['answer', { text: 'An answer without deltas.' }], ['done', { ok: true }],
  ]) }));
  await page.locator('#input').fill('answer only'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Ready');
  assert.equal(await page.getByText('An answer without deltas.', { exact: true }).count(), 1);
  await page.unroute('**/api/chat?**');
  await page.route('**/api/chat?**', r => r.fulfill({ status: 401, json: { error: 'Unauthorized' } }));
  await page.locator('#input').fill('auth check'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Request failed'));
  assert.equal(await page.locator('#imagine .core-label').textContent(), 'something went wrong');
  await page.unroute('**/api/chat?**');
  await page.locator('#new-chat').click();
  await page.waitForSelector('#home');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile has no horizontal overflow');
  await page.screenshot({ path: path.join(output, 'phoenix-small.png') });
  await page.locator('#c-model').click();
  await page.waitForFunction(() => document.querySelector('.explorer-count')?.textContent.includes('1200'));
  const box = await page.locator('#modeldrop').boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'picker fits small viewport');
  await page.screenshot({ path: path.join(output, 'phoenix-small-models.png') });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async () => {
    const c = await window.MAJIN_ONBOARD.api('/config');
    const routes = Object.fromEntries(Object.keys(c.config.models.routes).map(k => [k, 'demo/demo-fast']));
    await window.MAJIN_ONBOARD.api('/config', { method: 'PATCH', body: { models: { provider: 'demo', routes }, moa: { policy: 'off' } } });
  });
  await page.locator('#input').fill('hi'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#send').textContent === 'Stop');
  await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Stopped');
  assert.equal(await page.locator('#imagine .core-label').textContent(), 'stopped');
  await page.locator('#input').fill('hi'); await page.locator('#send').click();
  await page.waitForFunction(() => document.querySelector('#status').textContent === 'Ready');
  assert.ok(await page.getByText('I am in demo mode', { exact: false }).count(), 'real backend mock streams through actual HTTP endpoint');
  const longChat = await page.evaluate(() => {
    const t = performance.now();
    for (let i = 0; i < 300; i++) addMsg(i % 2 ? 'majin' : 'user', i % 2 ? 'MAJIN' : 'You', 'History message ' + i);
    const scroller = document.querySelector('#scroller'); scroller.scrollTop = 100;
    scroller.dispatchEvent(new Event('scroll'));
    appendDelta('A new response while reading older messages.');
    return { top: scroller.scrollTop, milliseconds: performance.now() - t };
  });
  assert.equal(longChat.top, 100, 'streaming preserves scroll position while reading history');
  console.log('Long conversation render (300 messages): ' + Math.round(longChat.milliseconds) + 'ms');
  assert.deepEqual(errors, [], 'no browser JavaScript errors');
  console.log('PASS: startup, token injection, 1200 models, pagination, free filter, search, exact route save, Escape/focus, 6 provider errors, no false success, streamed answer, clean transcript, new chat, small viewport; no paid calls.');
} finally {
  await browser?.close(); child.kill();
  // Keep disposable MAJIN data for debugging, never write user credentials here.
}
