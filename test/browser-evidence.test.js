import test from 'node:test';
import assert from 'node:assert/strict';
import { VERIFY_JS, verificationCriteria, verifyObserved } from '../src/core/browser-evidence.js';

test('verify browser evidence requires a concrete observable expectation',()=>{
  assert.equal(verificationCriteria({}).ok,false);
  assert.equal(verificationCriteria({text:'Saved'}).ok,false);
  assert.equal(verificationCriteria({checked:'true'}).ok,false);
  assert.equal(verificationCriteria({selector:'#saved'}).ok,true);
  assert.equal(verificationCriteria({url:'/done'}).ok,true);
});
test('successful click alone is not proof: expected element absent fails',()=>{
  const c=verificationCriteria({selector:'#success',text:'Saved'});
  const r=verifyObserved(c,{valid:true,url:'https://example.test',title:'Example',exists:false,visible:false,textMatch:false});
  assert.equal(r.ok,false);
  assert.ok(r.failures.some(x=>x.name==='element_present'));
});
test('visible element and expected text constitute evidence',()=>{
  const c=verificationCriteria({selector:'#success',text:'Saved',url:'/done'});
  const r=verifyObserved(c,{valid:true,url:'https://example.test/done',title:'Saved',exists:true,visible:true,textMatch:true,urlMatch:true});
  assert.equal(r.ok,true);assert.equal(r.failures.length,0);
});
test('checkbox state is verified, not assumed based on click',()=>{
  const c=verificationCriteria({selector:'#consent',checked:'true'});
  const no=verifyObserved(c,{valid:true,url:'',title:'',exists:true,visible:true,checked:false});
  assert.equal(no.ok,false);
  const yes=verifyObserved(c,{valid:true,url:'',title:'',exists:true,visible:true,checked:true});
  assert.equal(yes.ok,true);
});
test('absence assertions and malformed CSS fail safely',()=>{
  const c=verificationCriteria({selector:'.gone',present:'false'});
  assert.equal(verifyObserved(c,{valid:true,url:'',title:'',exists:false,visible:false}).ok,true);
  assert.equal(verifyObserved(c,{valid:false,reason:'invalid_selector'}).ok,false);
  assert.match(VERIFY_JS,/invalid_selector/);
  assert.doesNotMatch(VERIFY_JS,/input\.value|document\.cookie/);
});
test('tool remains read-only and returns assertion_failed instead of fake completion',async()=>{
  const fs=await import('node:fs');
  const src=fs.readFileSync('src/core/tools/web.js','utf8');
  assert.match(src,/name: 'browser\.verify'/);
  assert.match(src,/risk: 'read'/);
  assert.match(src,/code:'assertion_failed'/);
  assert.match(src,/verifyObserved\(criteria,observed\)/);
});
