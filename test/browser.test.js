/**
 * MAJIN — browser-use hardening tests. The CDP wire itself needs a real browser
 * (covered on the CI Windows box with Edge/Chrome headless — TODO label) but every
 * DETERMINISTIC piece is proven here: the loop guard, the slot pool, the
 * discovery tables, and the evidence rules in the tool wiring.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const { LoopJournal, createBrowserPool, browserCandidates, findBrowser, isOpen, closeFor, _resetBrowser } = await import('../src/core/browser.js');

test('loop guard: three identical consecutive actions stop the agent cold, in its own words', () => {
  const j = new LoopJournal();
  j.guard('t1', 'browser.click:#next');
  j.guard('t1', 'browser.click:#next');
  assert.throws(() => j.guard('t1', 'browser.click:#next'), /browser loop detected/);
  // a different action between resent attempts resets the counter
  const k = new LoopJournal();
  k.guard('t2', 'browser.click:#next');
  k.guard('t2', 'browser.fill:#name');
  assert.doesNotThrow(() => k.guard('t2', 'browser.click:#next'), 'an intervening action is not a loop');
  // different sessions never contaminate each other
  const m = new LoopJournal();
  m.guard('t3', 'browser.click:#next');
  m.guard('t3', 'browser.click:#next');
  assert.doesNotThrow(() => m.guard('t4', 'browser.click:#next'), 'sessions are isolated (autopilot G)');
  assert.ok(m.acts('t3').length >= 2 && m.acts('t4').length === 1, 'journal is readable per session');
});

test('slot pool: the fleet cap queues an extra session, release opens the gate', async () => {
  const held = new Map();
  const fakeLocks = {
    async acquire(key, owner) {
      if (held.has(key)) throw new Error('busy');
      held.set(key, owner);
      return () => held.delete(key);
    },
  };
  const pool = createBrowserPool({ locks: fakeLocks, max: 2 });
  assert.equal(await pool.claim('a'), 1, 'first session takes slot 1');
  assert.equal(await pool.claim('b'), 2, 'second takes slot 2');
  const err = await pool.claim('c').then(() => null, (e) => e);
  assert.ok(err, 'a third session must wait');
  assert.match(err.message, /all 2 browser instances are busy/, 'waiting is honest about why');
  pool.release('a');
  assert.equal(await pool.claim('c'), 1, 'the freed slot is handed to the waiter in order');
  assert.equal(pool.count(), 2);
  pool.release('b');
  pool.release('c');
  assert.equal(pool.count(), 0, 'every slot returns to the fleet');
  assert.equal(await pool.claim('a'), 1, 'pool fully resets');
});

test('re-claim by the same session is idempotent (never double-spawns its own window)', async () => {
  const held = new Map();
  const fakeLocks = {
    async acquire(key, owner) {
      if (held.has(key)) throw new Error('busy');
      held.set(key, owner);
      return () => held.delete(key);
    },
  };
  const pool = createBrowserPool({ locks: fakeLocks, max: 3 });
  const first = await pool.claim('s');
  const again = await pool.claim('s');
  assert.equal(first, again, 'same session keeps its own window');
  assert.equal(pool.count(), 1, 'no phantom instance');
});

test('browser discovery: candidates exist for every platform; findBrowser is honest when nothing is installed', () => {
  for (const [p, min] of [['win32', 5], ['darwin', 3], ['linux', 5]]) {
    const list = browserCandidates(p, { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF', LOCALAPPDATA: 'C:\\L' });
    assert.ok(list.length >= min, `${p}: at least ${min} candidates (got ${list.length})`);
  }
  const win = browserCandidates('win32', { 'ProgramFiles(x86)': 'C:\\PF86', ProgramFiles: 'C:\\PF' });
  assert.ok(win[0].includes('Edge'), 'Edge first on Windows — it ships with the OS');
  assert.equal(findBrowser(['C:\\definitely\\not\\installed\\msedge.exe']), null, 'nothing installed says nothing installed');
});

test('process-wide session helpers stay truthful without a browser', () => {
  _resetBrowser();
  assert.equal(isOpen('nothing-here'), false);
  assert.equal(closeFor('nothing-here'), false, 'closing nothing reports nothing closed');
});

test('click follows a spawned tab, and the recovery cookbook lives in the system prompt', async () => {
  const web = (await import('node:fs')).readFileSync(new URL('../src/core/tools/web.js', import.meta.url), 'utf8');
  assert.match(web, /followNewTarget/, 'click must attach to a tab the click itself spawned');
  assert.match(web, /new tab followed/, 'the agent is told what actually happened');
  const agent = (await import('node:fs')).readFileSync(new URL('../src/core/agent.js', import.meta.url), 'utf8');
  assert.match(agent, /browser\.read the page, try a narrower selector/, 'the recovery path is taught, deterministic order');
  assert.match(agent, /never click the same failing element more than twice/, 'the loop guard is explained to the model');
});

test('the browser tools are registered with guard-approved risks and loop-journal wiring', async () => {
  const { webTools } = await import('../src/core/tools/web.js');
  const names = webTools.map((t) => t.name);
  for (const want of ['browser.open', 'browser.read', 'browser.click', 'browser.fill', 'browser.upload', 'browser.shot', 'browser.close']) {
    assert.ok(names.includes(want), `${want} registered`);
  }
  const acts = Object.fromEntries(webTools.filter((t) => t.name.startsWith('browser.')).map((t) => [t.name, t]));
  assert.equal(acts['browser.open'].risk, 'exec', 'opening a browser is an act on the machine — approvable');
  assert.equal(acts['browser.click'].risk, 'exec');
  assert.equal(acts['browser.fill'].risk, 'exec');
  assert.equal(acts['browser.upload'].risk, 'exec', 'uploading a file is an outward act too');
  assert.equal(acts['browser.read'].risk, 'read');
  assert.equal(acts['browser.shot'].risk, 'read');
  /* a closed fleet answers with a sentence, not a stack trace */
  const r = await acts['browser.read'].run({ selector: '' }, { session: 'never-opened-anywhere', cfg: { get: () => 0 } });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'browser_closed');
});
