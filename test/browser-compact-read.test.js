import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactBrowserText } from '../src/core/browser-compact.js';

test('compact browser read is bounded and does not mutate source',()=>{
  const source=Array.from({length:140},(_,i)=>'Item '+i+' : '+('Example page content '.repeat(7))).join('\n');
  const before=source;
  const out=compactBrowserText(source);
  assert.equal(source,before);
  assert.ok(out.outputChars<=2600);
  assert.ok(out.outputChars<out.originalChars);
  assert.match(out.text,/Item 0/);
  assert.equal(out.truncated,true);
});
test('short and repetitive page content is preserved without invented evidence',()=>{
  const source='Dashboard\nSave\nSave\nAccount';
  const out=compactBrowserText(source);
  assert.match(out.text,/Dashboard/);
  assert.match(out.text,/Account/);
  assert.equal(out.uniqueLines,3);
  assert.ok(!out.text.includes('password'));
});
test('browser.read compact is explicitly opt-in and visible as one inline activity indicator',()=>{
  const web=fs.readFileSync('src/core/tools/web.js','utf8');
  const app=fs.readFileSync('src/ui/app.js','utf8');
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(web,/String\(mode\)\.toLowerCase\(\)==='compact'/);
  assert.match(web,/compactBrowserText\(sourceText\)/);
  assert.match(web,/visibleChars:compressed\.outputChars/);
  assert.match(app,/ev\.meta\?\.mode==='compact'/);
  assert.match(html,/work-progress\[data-phase="compact"\]/);
});
