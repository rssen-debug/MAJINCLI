import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { OUTLINE_JS, formatPageOutline } from '../src/core/browser-outline.js';

test('page outline script is read-only, bounded and does not expose input values',()=>{
  assert.match(OUTLINE_JS,/aria-label/);
  assert.match(OUTLINE_JS,/entries\.length >= limit/);
  assert.match(OUTLINE_JS,/^\(\(\) => \{/);
  assert.doesNotMatch(OUTLINE_JS,/\.value|document\.cookie|localStorage|\.outerHTML/);
  assert.doesNotMatch(OUTLINE_JS,/\.click\(|\.setAttribute\(/);
});
test('outline formats headings and regions with bounded safe text',()=>{
  const result=formatPageOutline({title:'Test',entries:[
    {role:'main',name:'Content',level:null},
    {role:'h2',name:'Billing\nOverview',level:2},
    {role:'navigation',name:'Menu',level:null}
  ]});
  assert.match(result,/Page structure — Test/);
  assert.match(result,/h2 2 "Billing Overview"/);
  assert.match(result,/navigation "Menu"/);
  assert.ok(result.split('\n').length<=5);
});
test('outline is opt-in on existing browser.elements tool, with no new permissions',()=>{
  const tools=fs.readFileSync('src/core/tools/web.js','utf8');
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(tools,/outline = 'false'/);
  assert.match(tools,/b\.eval\(OUTLINE_JS\)/);
  assert.match(tools,/pageOutline \? result/);
  assert.match(html,/@keyframes majin-trace/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});

test('outline cap cannot go negative or exceed page-structure limit',()=>{
 const entries=Array.from({length:100},(_,i)=>({role:'heading',name:'Heading '+i}));
 const negative=formatPageOutline({title:'Safe',entries},{cap:-1});
 assert.doesNotMatch(negative,/Heading 0/);
 const huge=formatPageOutline({title:'Safe',entries},{cap:999999});
 assert.match(huge,/Heading 54/);
 assert.doesNotMatch(huge,/Heading 55/);
 assert.match(huge,/more sections omitted/);
});
test('outline visual cue remains inside composer with reduced motion',()=>{
 const html=fs.readFileSync('src/ui/index.html','utf8');
 assert.match(html,/majin-outline-glow/);
 assert.match(html,/prefers-reduced-motion:reduce/);
});
