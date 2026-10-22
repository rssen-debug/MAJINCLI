import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {noteBrowserAction,observeBrowserPage,clearBrowserStagnation} from '../src/core/browser-stagnation.js';

const page=(text='Same page',url='https://example.test')=>({url,title:'Example',text,controls:[{selector:'#send',label:'Send'}]});
test('reads alone never count as browser-action stagnation',()=>{
  const s='reads-only';
  for(let i=0;i<12;i++)assert.equal(observeBrowserPage(s,page()).stagnant,false);
  clearBrowserStagnation(s);
});
test('two completed actions with same observed page produce advisory',()=>{
  const s='unchanged';
  observeBrowserPage(s,page());
  noteBrowserAction(s);
  assert.equal(observeBrowserPage(s,page()).unchangedActions,1);
  noteBrowserAction(s);
  const p=observeBrowserPage(s,page());
  assert.equal(p.stagnant,true);
  assert.equal(p.unchangedActions,2);
  clearBrowserStagnation(s);
});
test('real content or URL change resets stagnation and keeps sessions isolated',()=>{
  observeBrowserPage('a',page());observeBrowserPage('b',page());
  for(let i=0;i<2;i++){noteBrowserAction('a');observeBrowserPage('a',page());}
  assert.equal(observeBrowserPage('a',page()).stagnant,true);
  noteBrowserAction('a');
  assert.equal(observeBrowserPage('a',page('New visible result')).stagnant,false);
  noteBrowserAction('b');
  assert.equal(observeBrowserPage('b',page('Other','https://example.test/next')).stagnant,false);
  clearBrowserStagnation('a');clearBrowserStagnation('b');
});
test('tool and one-line UI are actually wired to browser stagnation evidence',()=>{
  const tools=fs.readFileSync('src/core/tools/web.js','utf8');
  const app=fs.readFileSync('src/ui/app.js','utf8');
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(tools,/observeBrowserPage\(session/);
  assert.match(tools,/noteBrowserAction\(session\)/);
  assert.match(tools,/clearBrowserStagnation\(ctx.session/);
  assert.match(app,/meta\?\.stagnation\?\.stagnant===true/);
  assert.match(html,/data-phase="stagnation"/);
});
