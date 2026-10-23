// Actual local browser cancellation, with no model or private-origin automation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'majin-browser-abort-'));
process.env.MAJIN_HOME=home;
const {openFor,closeFor,isOpen,findBrowser,createBrowserPool}=await import('../../src/core/browser.js');
test('aborting a stalled real navigation releases its browser and fleet slot without a late session', {timeout:60000},async t=>{
  if(!findBrowser()){t.skip('No installed browser; no actual process cancellation PASS.');return;}
  let observedStall;const started=new Promise(r=>{observedStall=r;});
  const responses=new Set();
  const server=http.createServer((req,res)=>{responses.add(res);res.on('close',()=>responses.delete(res));if(req.url==='/stall'){observedStall();return;}res.end('<title>Controlled cancellation fixture</title>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const pool=createBrowserPool({max:1}), ctl=new AbortController(), session='controlled-aborted-launch';
  let debugUrl;
  try {
    const opening=openFor({session,url:`http://127.0.0.1:${server.address().port}/stall`,pool,signal:ctl.signal,wsFactory:u=>{debugUrl=u;return new WebSocket(u);}});
    const rejected=assert.rejects(opening,/controlled cancellation/);
    await Promise.race([started,opening.then(()=>{throw Error('Stalled fixture unexpectedly loaded');})]);
    ctl.abort(new Error('controlled cancellation'));
    await rejected;
    assert.equal(pool.count(),0);assert.equal(isOpen(session),false);
    const endpoint=new URL(debugUrl);endpoint.protocol='http:';endpoint.pathname='/json/version';
    let debugAlive=true;
    for(let attempt=0;attempt<20 && debugAlive;attempt++){
      try{await fetch(endpoint,{signal:AbortSignal.timeout(500)});await new Promise(r=>setTimeout(r,100));}catch{debugAlive=false;}
    }
    assert.equal(debugAlive,false,'cancelled owned browser no longer exposes its debug endpoint');
    assert.equal(isOpen(session),false,'completed cancellation cannot later register a browser session');
    await assert.rejects(openFor({session:'never-started',signal:ctl.signal,pool}),/controlled cancellation/);
    assert.equal(pool.count(),0,'pre-cancelled work claims no slot');
  } finally {
    ctl.abort(new Error('test cleanup'));await closeFor(session,{wait:true});
    for(const res of responses)res.destroy();await new Promise(r=>server.close(r));
    const resolved=path.resolve(home);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep+'majin-browser-abort-'));
    await fs.promises.rm(resolved,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  }
});
