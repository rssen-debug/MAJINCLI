import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
test('voice frontend parses under Node and preserves explicit mic opt-in',()=>{
  const f='src/ui/app.js';
  execFileSync(process.execPath,['--check',f]);
  const source=fs.readFileSync(f,'utf8');
  assert.match(source,/function micToggle\(/);
  assert.match(source,/voiceWanted=true/);
  assert.match(source,/getUserMedia\(\{audio:true\}\)/);
  assert.match(source,/audioStream\.getTracks\(\)/);
  assert.match(source,/speechSynthesis\.speak\(utterance\)/);
  assert.match(source,/onend=utterance\.onerror=/);
});
test('voice UI has accessible audio meter and browser translate suppression',()=>{
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(html,/content="notranslate"/);
  assert.match(html,/translate="no"/);
  assert.match(html,/id="voice-stage"/);
  assert.match(html,/aria-pressed="false"/);
});

test('Windows browser app titlebar icon uses same pink MAJIN identity with cache-busting path',()=>{
  const html=fs.readFileSync('src/ui/index.html','utf8');
  const svg=fs.readFileSync('src/ui/majin-brand.svg','utf8');
  assert.match(html,/rel="icon" type="image\/svg\+xml" sizes="any" href="\/majin-brand\.svg\?v=2"/);
  assert.doesNotMatch(html,/rel="icon" href="\/logo\.png"/);
  assert.match(svg,/<svg /);
  assert.match(svg,/#ed599d/);
  assert.match(svg,/<rect[^>]+rx="17"/);
});
