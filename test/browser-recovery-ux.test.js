import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { explainVerifyFailure } from '../src/core/browser-recovery.js';

test('missing DOM target recommends fresh grounded snapshot not a blind click',()=>{
  const hint=explainVerifyFailure({selector:'#save'},[{name:'element_present'}]);
  assert.match(hint,/browser\.elements/);
  assert.match(hint,/refresh/);
  assert.match(hint,/Do not repeat an identical click/);
});
test('failure categories produce specific repair strategies',()=>{
  assert.match(explainVerifyFailure({selector:'#status'},[{name:'element_text_contains'}]),/browser\.read/);
  assert.match(explainVerifyFailure({url:'/done'},[{name:'url_contains'}]),/redirects/);
  assert.match(explainVerifyFailure({selector:'#ok'},[{name:'checkbox_checked'}]),/checked/);
  assert.match(explainVerifyFailure({},[{name:'stable_duration'}]),/persistent final state/);
});
test('browser.verify uses deterministic failure-specific repair guidance',()=>{
  const src=fs.readFileSync('src/core/tools/web.js','utf8');
  assert.match(src,/explainVerifyFailure\(criteria,verdict\.failures\)/);
  assert.match(src,/code:'assertion_failed'/);
});
test('composer adds one quiet activity trail, no extra panel, accessible reduced motion',()=>{
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(html,/body:has\(#work-progress:not\(\[hidden\]\)\) #composer::after/);
  assert.match(html,/@keyframes majin-work-trail/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});
