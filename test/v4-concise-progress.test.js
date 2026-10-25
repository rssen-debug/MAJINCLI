import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('V4 defaults to short factual conclusions, not verbose reports',()=>{
 const src=fs.readFileSync(new URL('../src/v4/agent.js',import.meta.url),'utf8');
 assert.match(src,/DEFAULT: reply in 1–3 short, direct sentences/);
 assert.match(src,/never invent or reveal hidden chain-of-thought/);
});
test('transient historical failure must not permanently disable browser_open',()=>{
 const src=fs.readFileSync(new URL('../src/v4/agent.js',import.meta.url),'utf8');
 assert.match(src,/const deterministicAvoid = avoided\.filter/);
 for(const reason of ['UNKNOWN','TIMEOUT','RATE_LIMIT','TOOL_TIMEOUT','MODEL_BUDGET']){
  assert.match(src,new RegExp(reason));
 }
 assert.match(src,/if \(deterministicAvoid\.length && !turn\?\.allowAvoided\)/);
});
test('live activity, evidence and supported previews remain in same work row',()=>{
 const src=fs.readFileSync(new URL('../src/v4/ui/app.js',import.meta.url),'utf8');
 assert.match(src,/progressCard\.detail : els\.thread\)\.append\(node\)/);
 /* The words moved to strings.js (the i18n gate forbids Swedish literals in
    shipped code), so the pin follows the behaviour — one row that says done vs
    problem and names the tool — instead of the exact Swedish spellings. */
 assert.match(src,/t\('progress\.done'\).*t\('progress\.problem'\).*toolLabel\(data\.name\)/);
 assert.ok(src.includes('if (!/\\.(html?|htm)$/i.test(name))'));
});
