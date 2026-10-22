import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankRecoveryControls, formatRecoverySuggestions } from '../src/core/browser-recovery-rank.js';

const controls=[
  {selector:'#send',label:'Send message',tag:'button',type:'button'},
  {selector:'#submit-application',label:'Submit application',tag:'button',type:'submit'},
  {selector:'#cancel',label:'Cancel',tag:'button',type:'button'},
  {selector:'#password',label:'Password',tag:'input',type:'password'},
  {selector:'input[name="email"]',label:'Email address',tag:'input',type:'text'},
];

test('failed selector points to observed matching controls, not arbitrary guessed clicks',()=>{
  const hits=rankRecoveryControls('#submit-application',controls);
  assert.ok(hits.some(x=>x.selector==='#submit-application'));
  assert.ok(!hits.some(x=>x.selector==='#cancel'));
  assert.match(formatRecoverySuggestions('email',controls),/input\[name="email"\]/);
});
test('never echo password controls or ungrounded CSS selectors',()=>{
  const hits=rankRecoveryControls('password',[
    ...controls,
    {selector:':nth-child(44)',label:'Password',type:'text'},
    {selector:'#token',label:'Secret token',type:'hidden'}
  ]);
  assert.equal(hits.length,0);
});
test('bounded results and conservative no-match behavior',()=>{
  assert.deepEqual(rankRecoveryControls('mystery',controls),[]);
  assert.equal(formatRecoverySuggestions('mystery',controls),'');
  assert.ok(rankRecoveryControls('button',controls,{limit:1}).length<=1);
});
test('browser failed-click and UI show recovery without extra panels',()=>{
  const code=fs.readFileSync('src/core/tools/web.js','utf8');
  const ui=fs.readFileSync('src/ui/app.js','utf8');
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(code,/formatRecoverySuggestions\(selector \|\| accessibleName \|\| ref, controls\)/);
  assert.match(ui,/Finding the right control on this page/);
  assert.match(html,/data-phase="recovery-match"/);
  assert.match(html,/prefers-reduced-motion:reduce/);
});
