import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
test('speech recognition arms, sends actual user transcript and suspends while assistant speaks',()=>{
  const src=fs.readFileSync('src/ui/app.js','utf8');
  assert.match(src,/window\.SpeechRecognition\s*\|\|\s*window\.webkitSpeechRecognition/);
  assert.match(src,/r\.interimResults=true/);
  assert.match(src,/if\(!complete\.trim\(\)\) return/);
  assert.match(src,/send\(command\)/);
  assert.match(src,/S\.handsFree=true/);
  assert.match(src,/if\(S\.handsFree&&!S\.busy\)startMic\(\)/);
  assert.match(src,/engine\.cancel\(\);engine\.resume\(\);engine\.speak\(u\)/);
  assert.match(src,/u\.onerror=e=>finish\(new Error\('Speech playback failed:/);
  assert.match(src,/audio\.onerror=/);
});
test('UI indicates states, can stop listening and respects reduced motion',()=>{
  const html=fs.readFileSync('src/ui/index.html','utf8');
  assert.match(html,/<html lang="en" translate="no">/);
  assert.match(html,/name="google" content="notranslate"/);
  assert.match(html,/aria-pressed="false">Talk/);
  assert.match(html,/data-voice-mode="listening"/);
  assert.match(html,/prefers-reduced-motion/);
});
test('release version is consistent across all packaging paths',()=>{
  for (const p of ['package.json','package-lock.json']) {
    const v=JSON.parse(fs.readFileSync(p,'utf8'));assert.equal(v.version,'1.0.8');
  }
  assert.equal(JSON.parse(fs.readFileSync('package-lock.json','utf8')).packages[''].version,'1.0.8');
  for(const p of ['src/core/version.js','installer/majin.iss','scripts/publish.ps1']){
    const text=fs.readFileSync(p,'utf8');assert.match(text,/1\.0\.8/);
  }
});

test('speech output reports playback failure and never strands hands-free listening',()=>{
  const src=fs.readFileSync('src/ui/app.js','utf8');
  assert.match(src,/Speech playback timed out/);
  assert.match(src,/ev\.text \|\| S\.curBody/);
  assert.match(src,/!S\.cancelled && audibleReply/);
  assert.match(src,/Speech playback failed/);
  assert.match(src,/Voice output failed/);
  assert.match(src,/finally\s*\{\s*speechActive=false;/);
  assert.match(src,/if\(S\.handsFree&&!S\.busy\)startMic\(\)/);
});

test('keyboard turns do not trigger Talk; spoken turns stay hands-free',()=>{
  const src=fs.readFileSync('src/ui/app.js','utf8');
  assert.match(src,/async function send\(text, options = \{\}\)/);
  assert.match(src,/if \(!options\.voiceTurn\) \{/);
  assert.match(src,/if \(S\.handsFree\) \{ S\.handsFree = false; stopMic\(\); \}/);
  assert.match(src,/S\.voiceTurn = Boolean\(options\.voiceTurn\)/);
  assert.match(src,/send\(command, \{ voiceTurn: true \}\)/);
  assert.match(src,/S\.voice && S\.voiceTurn && !S\.cancelled/);
});
test('workspace preview is persistent between tasks and reloads after HTML writes',()=>{
  const studio=fs.readFileSync('src/ui/studio.js','utf8');
  const reset=studio.match(/function resetRun\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert.ok(reset);
  assert.doesNotMatch(reset,/files\.clear\(\)|studio-preview'\)\.textContent = ''/);
  assert.match(studio,/previewedPath = path/);
  assert.match(studio,/void previewFile\(ev\.meta\.path\)/);
});
