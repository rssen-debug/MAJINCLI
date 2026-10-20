import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from '../src/core/tools/index.js';
import { toSchema } from '../src/core/tools/registry.js';

/** R1-låset (real-world audit d04 2026-10-20): required föds ur param-deklarationens
 *  markörer och INGET annat — samma schema i källan och i paketerad exe.
 *  Om någon ändrar ett verktyg utan att deklarera valfria parametrar explicit,
 *  faller detta test — aldrig den installerade appen i produktion.
 */
const OPT_RE = /\?\s*:|\(valfritt\)|\(optional\)|\boptional\b|default:|standard:|endast om|om det anges|valfritt/i;

test('a11y-schema: golden required sets for the QA-critical tools', () => {
  const by = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t.parameters.required || []]));
  assert.deepEqual(by['browser.open'], ['url']);
  assert.deepEqual(by['fs.write'].sort(), ['content', 'path']);
  assert.deepEqual(by['fs.read'], ['path']);
  assert.deepEqual(by['shell.run'], ['command']);
  assert.deepEqual(by['sys.info'], []);
  assert.deepEqual(by['net.http'], ['url']);
  assert.deepEqual(by['web.search'], ['query']);
  // action-verktygen har kodade defaults (action='list'/'show') — required är ärligt tom
  assert.deepEqual(by['majin.provider'], []);
  assert.deepEqual(by['majin.memory'], []);
});

test('a11y-schema: every tool param is either declared-optional or listed required — no third state', () => {
  for (const t of ALL_TOOLS) {
    const req = new Set(t.parameters.required || []);
    for (const [k, v] of Object.entries(t.raw || {})) {
      const marked = typeof v === 'string' ? (/^\w+\?:/.test(v.trim()) || OPT_RE.test(v)) : (v.optional === true || v.required === false);
      if (!marked && typeof v === 'object' && v.required !== true && v.optional !== true) {
        assert.fail(`unmarked object param ${t.name}.${k} — ambiguity must not survive (objektscheman sätts explicit)`);
      }
      if (!marked) assert.ok(req.has(k), `${t.name}.${k} is unmarked but NOT in required — marker/derivation desync`);
      if (marked) assert.ok(!req.has(k), `${t.name}.${k} is marked optional but still in required — marker ignored`);
    }
  }
});

test('a11y-schema: toSchema ignores run.toString() — same result before and after source mangling', () => {
  const params = { url: 'string: address', headless: 'boolean: no visible window (default: true)' };
  const base = toSchema(params, null);
  const mangled = () => { const x = 1 + 1; return x; }; // samma "run" efter minifiering som i exen
  const after = toSchema(params, mangled);
  assert.deepEqual(after, base);
  assert.deepEqual(base.required, ['url']);
});

test('a11y-schema: required-parity between registered schema and pure raw-derivation (package erosion lock)', () => {
  for (const t of ALL_TOOLS) {
    const re = toSchema(t.raw);
    assert.deepEqual(re.required.slice().sort(), (t.parameters.required || []).slice().sort(),
      `${t.name}: registered required ≠ raw-derived required — någon har injicerat andra sanningar (packaging erosion)`);
  }
});
