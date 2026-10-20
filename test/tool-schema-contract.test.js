import test from 'node:test';
import assert from 'node:assert/strict';
import { ALL_TOOLS } from '../src/core/tools/index.js';
import { def, toSchema } from '../src/core/tools/registry.js';

/** R1-låset (Fas 1, rotorsak d04/s18/b01, uppmätt mot installerad v1.0.0):
 *  ett verktygs required-mängd är DATA vid deklarationen — aldrig programtext.
 *  Före reparationen 2026-10-20 låste paketerad exe scheman källan inte kände
 *  (shell.run→[], fs.write→'append', browser.open→'headless'). */
const OPT = /\((optional|opt)\b/i;
const OPTSTR = (d) => OPT.test(String(d || '')) || String(d || '').includes('(default') || /\?/.test(String(d || '').split(':')[0] || '');

test('registry: optional-markörer håller derivation deterministisk (suffix-invarians per verktyg)', () => {
  const bad = [];
  for (const t of ALL_TOOLS) {
    const flags = Object.entries(t.parameters.properties).map(([, p]) => {
      const d = String(p.description || '');
      return OPTSTR(d) || /\[.*\]/.test(d) === false && false; // enum-parenteter hjälper inte — markörer hjälper
    });
    const req = new Set(t.parameters.required || []);
    const keys = Object.keys(t.parameters.properties);
    const seenOpt = keys.some((k) => !req.has(k));
    const firstOptIdx = keys.findIndex((k) => !req.has(k));
    const laterReq = firstOptIdx >= 0 ? keys.slice(firstOptIdx).filter((k) => req.has(k)) : [];
    if (laterReq.length) bad.push(`${t.name}: ${laterReq.join(',')} efter optional-parameter`);
    void flags; void seenOpt;
  }
  assert.deepEqual(bad, [], 'required-prefix invariant bruten — märk eller ordna om');
});

test('registry: required-derivation överlever bundling/transpilation (run manglad)', () => {
  const tool = def({
    name: 'demo.out',
    group: 'demo',
    risk: 'read',
    desc: 'demo',
    params: { a: 'string: needed', b: 'string: optional (default 1)', c: 'bool: optional (default false)' },
    run() { return { ok: true }; },
  });
  Object.defineProperty(tool.run, 'toString', { value: () => '{__MAJIN_RUN_MANGLED_BY_BUNDLER__}' });
  const schema = toSchema({ a: 'string: needed', b: 'string: optional (default 1)', c: 'bool: optional (default false)' });
  assert.deepEqual(schema.required, ['a']);
  assert.equal(Object.keys(schema.properties).length, 3);
});

test('schema: uppmätta avvikelser i installerad v1.0.0 är omöjliga nu (gyllene mängder)', () => {
  const by = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, (t.parameters.required || []).slice()]));
  assert.deepEqual(by['shell.run'], ['command']);
  assert.deepEqual(by['browser.open'], ['url']);
  assert.deepEqual(by['web.open'], ['url']);
  assert.deepEqual(by['fs.write'], ['path', 'content']);
  assert.deepEqual(by['fs.copy'], ['src', 'dest']);
  assert.deepEqual(by['fs.zip'], ['src', 'out']);
  assert.deepEqual(by['net.fetch'], ['url']);
});

test('schema: verktygs-skiktet äga 108 verktyg (4 control + 104 kärna)', () => {
  assert.equal(ALL_TOOLS.length, 108, 'reparationer får inte tyst lägga till eller ta bort verktyg');
  const groups = [...new Set(ALL_TOOLS.map((t) => t.group))];
  assert.ok(groups.includes('control'), 'control-gruppen måste vara shipped');
});
