import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { browserRecoveryAdvice } from '../src/core/browser-evidence.js';

const fail=name=>[{name,expected:true,actual:false}];
test('different failures produce different safe recovery steps',()=>{
  const a=browserRecoveryAdvice(fail('element_unique'));
  const b=browserRecoveryAdvice(fail('url_contains'));
  const c=browserRecoveryAdvice(fail('checkbox_checked'));
  assert.equal(a.code,'ambiguous_selector');
  assert.equal(b.code,'navigation_mismatch');
  assert.equal(c.code,'state_mismatch');
  assert.notEqual(a.next,b.next);
  assert.match(a.next,/unique visible ref/);
  assert.doesNotMatch(a.next,/repeat the same click/i);
});
test('recovery is bounded and safe when failure list is missing',()=>{
  assert.equal(browserRecoveryAdvice().code,'unverified_result');
  assert.equal(browserRecoveryAdvice([null,{}, {name:'unknown'}]).code,'unverified_result');
});
test('live browser tools attach recovery evidence rather than invented success',()=>{
  const src=fs.readFileSync('src/core/tools/web.js','utf8');
  assert.match(src,/recovery:browserRecoveryAdvice\(verdict\.failures\)/);
  assert.match(src,/recovery:browserRecoveryAdvice\(proof\.failures\)/);
});
test('new visual state lives only inside existing chat composer',()=>{
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(html,/#composer #work-progress\[data-phase="problem"\] \.pulse::after/);
  assert.equal((html.match(/id="work-progress"/g)||[]).length,1);
});
