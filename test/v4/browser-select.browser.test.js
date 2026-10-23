// Actual local DOM actions; this regression does not prove real-model acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-select-test-'));
process.env.MAJIN_HOME = home;
const { findBrowser, openFor, closeFor } = await import('../../src/core/browser.js');
const { webTools } = await import('../../src/core/tools/web.js');
test('select fill resolves unique labels, rejects ambiguity/disabled choices and verifies retained internal value', {timeout:60000}, async t => {
  if (!findBrowser()) { t.skip('No browser binary; no real DOM verification.'); return; }
  const server = http.createServer((req,res) => { res.setHeader('content-type','text/html'); res.end('<select id="country"><option value="dk">Denmark</option><option value="se">Sweden</option><option value="1">Duplicate</option><option value="2">Duplicate</option><option value="x" disabled>Disabled</option></select><input id="secret" value="private-initial">'); });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const session='select-regression', ctx={session,cfg:{get:()=>undefined}};
  const run=(name,args)=>webTools.find(t=>t.name===name).run(args,ctx);
  try {
    assert.equal((await run('browser.open',{url:`http://127.0.0.1:${server.address().port}`,headless:true})).ok,true);
    const b=await openFor({session,cfgGet:()=>undefined});
    const filled=await run('browser.fill',{selector:'#country',value:'Sweden'});
    assert.equal(filled.ok,true); assert.equal(await b.eval('document.querySelector("#country").value'),'se');
    assert.doesNotMatch(JSON.stringify(filled),/Sweden|"se"|private-initial/);
    for (const value of ['Duplicate','Disabled','missing']) {
      const rejected=await run('browser.fill',{selector:'#country',value});
      assert.equal(rejected.error.code,'option_not_unique');
      assert.equal(await b.eval('document.querySelector("#country").value'),'se');
      // Reset the journal by observing rather than retrying identical actions indefinitely.
      await run('browser.read',{});
    }
    assert.equal((await run('browser.fill',{selector:'#country',value:'dk'})).ok,true);
    const privateFill=await run('browser.fill',{selector:'#secret',value:'private-after'});
    assert.equal(privateFill.ok,true); assert.doesNotMatch(JSON.stringify(privateFill),/private-/);
  } finally {
    await closeFor(session,{wait:true}); await new Promise(r=>server.close(r));
    const resolved=path.resolve(home);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'majin-select-test-'));
    await fs.promises.rm(resolved,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
