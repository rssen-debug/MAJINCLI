import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUND_JS, CLEAR_JS, rememberRefs, recallRef, clearRefs, renderElementsText, VERSION } from '../src/core/browser-ground.js';

test('W6 GROUND_JS is a self-contained page script (marks + refs + DOM anchoring)', () => {
  assert.match(GROUND_JS, /data-majin-ref/);
  assert.match(GROUND_JS, /majin-mark/);
  assert.match(GROUND_JS, /ff3ca5/, 'the marks are MAJIN-pink');
  assert.match(GROUND_JS, /getBoundingClientRect/);
  assert.match(GROUND_JS, /return { url:/);
  assert.ok(GROUND_JS.length < 4600, 'script must fit comfortably inside a CDP evaluate call');
});

test('W6 CLEAR_JS erases its markers and ref attributes fully', () => {
  assert.match(CLEAR_JS, /remove\(\)/);
  assert.match(CLEAR_JS, /removeAttribute\('data-majin-ref'\)/);
});

test('W6 refs are per-session, weak session-blindness is not possible', () => {
  rememberRefs('s1', [{ ref: 'e1', tag: 'button', text: 'Save' }]);
  rememberRefs('s2', [{ ref: 'e1', tag: 'a', text: 'Link' }]);
  assert.equal(recallRef('s1', 'e1').text, 'Save');
  assert.equal(recallRef('s2', 'e1').text, 'Link');
  assert.equal(recallRef('s1', 'e99'), null, 'unknown ref must return null (never guess)');
  clearRefs('s1');
  assert.equal(recallRef('s1', 'e1'), null);
  assert.equal(recallRef('s2', 'e1').text, 'Link', 'sessions stay isolated');
  clearRefs('s2');
});

test('W6 cache caps at 200 elements (bounded memory, honest bound)', () => {
  const many = Array.from({ length: 260 }, (_, i) => ({ ref: 'e' + (i + 1), tag: 'a', text: 'x' + i }));
  rememberRefs('cap-session', many);
  assert.equal(recallRef('cap-session', 'e199').tag, 'a');
  assert.equal(recallRef('cap-session', 'e250'), null, 'beyond-cap refs dropped deliberately');
  clearRefs('cap-session');
});

test('W6 renderElementsText is bounded and announces freshness', () => {
  const t = renderElementsText({ title: 'T', url: 'https://x.se', count: 3, elements: [
    { ref: 'e1', tag: 'input', role: 'text', text: 'Name', href: null, name: 'name', disabled: false },
    { ref: 'e2', tag: 'button', role: 'button', text: 'Go', href: null, name: null, disabled: false },
    { ref: 'e3', tag: 'a', role: 'link', text: 'Read more', href: 'https://x.se/read-more', name: null, disabled: true },
  ] });
  assert.match(t, /\[e1\] input\/text "Name"/);
  assert.match(t, /\[e3\] a\/link "Read more" → https:\/\/x\.se\/read-more \(disabled\)/);
  assert.ok(t.length < 2000, 'text stays bounded for the context window');
});

test('W6 stub-eval-shaped contract: GROUND_JS shape matches what the bridge returns', () => {
  const samplePayload = { url: 'https://x.se', title: 'X', count: 2, elements: [{ ref: 'e1', tag: 'button' }] };
  rememberRefs('contract', samplePayload.elements);
  assert.ok(recallRef('contract', 'e1'));
  clearRefs('contract');
  assert.ok(VERSION.startsWith('majin-ground/'));
});
