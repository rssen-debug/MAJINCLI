import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('browser.read provides opt-in focused main article extraction without changing default',()=>{
 const src=fs.readFileSync('src/core/tools/web.js','utf8');
 const i=src.indexOf("name: 'browser.read'");
 const j=src.indexOf("name: 'browser.click'",i);
 const read=src.slice(i,j);
 assert.match(read,/String\(mode\)\.toLowerCase\(\) === 'main' && !selector/);
 assert.match(read,/document\.querySelector\('main,\[role="main"\],article'\)/);
 assert.match(read,/document\.createTreeWalker\(scope,NodeFilter\.SHOW_TEXT\)/);
 assert.match(read,/nav,header,footer,aside,script,style,noscript,template/);
 assert.match(read,/Number\(computed\.opacity\)===0/);
 assert.match(read,/mode: focused \? 'main' : 'all'/);
 assert.match(read,/document\.body \? document\.body\.innerText/);
});
test('activity glow is inline and respects reduced motion',()=>{
 const html=fs.readFileSync('src/ui/index.html','utf8');
 assert.match(html,/#composer:has\(#work-progress:not\(\[hidden\]\)\)/);
 assert.match(html,/#composer #work-progress\[data-phase="stalled"\]/);
 assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
});
