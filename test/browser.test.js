import test from 'node:test';
import assert from 'node:assert/strict';
import { browserTools, validateUrl } from '../src/core/tools/browser.js';
import { ALL_TOOLS } from '../src/core/tools/index.js';

test('browser tools are registered and provider-agnostic', () => {
  const names = browserTools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'browser.open', 'browser.inspect', 'browser.click', 'browser.fill',
    'browser.check', 'browser.select', 'browser.upload', 'browser.press', 'browser.close',
  ]);
  for (const tool of browserTools) assert.ok(ALL_TOOLS.includes(tool), `${tool.name} is in the registry`);
  assert.match(browserTools[0].desc, /Playwright Core/);
  assert.match(browserTools[0].desc, /never submit/i);
  assert.match(browserTools.find((tool) => tool.name === 'browser.click').desc, /submit buttons are refused/i);
});

test('browser URL validation accepts only absolute http(s) URLs', () => {
  assert.equal(validateUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(validateUrl('http://localhost:3000'), 'http://localhost:3000/');
  for (const url of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'not a url']) {
    assert.throws(() => validateUrl(url), /http\(s\)|valid http/);
  }
});

test('browser form tools never expose a submit operation', () => {
  assert.equal(browserTools.some((tool) => /submit|apply/i.test(tool.name)), false);
  assert.match(browserTools.find((tool) => tool.name === 'browser.upload').desc, /not uploaded until the user submits/i);
});
