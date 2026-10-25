import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { CodexDriver } from '../../src/v5/codex-driver.js';
import { createDriverTools } from '../../src/v5/codex-tools.js';
import { FileAndAccessController } from '../../src/v5/files-access.js';
import { browserWriteAllowed } from '../../src/core/tools/browser.js';

test('browser write grants match exact origins and cannot be escalated by a subdomain or URL credentials', () => {
  const ctx = { browserWriteOrigins: ['https://employer.example'] };
  assert(browserWriteAllowed(ctx, 'https://employer.example/apply'));
  assert(!browserWriteAllowed(ctx, 'https://employer.example.attacker.test/apply'));
  assert(!browserWriteAllowed(ctx, 'https://other.example/apply'));
  assert(!browserWriteAllowed(ctx, 'https://user:pass@employer.example/apply'));
  assert(!browserWriteAllowed({}, 'https://employer.example/apply'));
});

test('real browser submits exact file bytes only for owner-granted origin; radio/select and idless controls work', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-submit-'));
  const expected = Buffer.from('CV FIXTURE ' + randomUUID());
  fs.writeFileSync(path.join(root, 'cv.pdf'), expected);
  let received = null, foreignWrites = 0;
  const foreign = http.createServer((req,res) => { if(req.method==='POST')foreignWrites++; res.end('foreign'); });
  await new Promise(resolve=>foreign.listen(0,'127.0.0.1',resolve));
  const foreignOrigin=`http://127.0.0.1:${foreign.address().port}`;
  const portal = http.createServer(async(req,res)=>{
    if(req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const form=await new Request('http://localhost/receive',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();
      const file=form.get('cv');received={radio:form.get('answer'),choice:form.get('choice'),name:form.get('name'),bytes:Buffer.from(await file.arrayBuffer())};
      res.end('APPLICATION RECEIVED');return;
    }
    res.setHeader('content-type','text/html');
    res.end(`<h1>Owned test portal</h1><form method="post" enctype="multipart/form-data"><label>Name<input name="name" required></label>
      <label><input type="radio" name="answer" value="yes" required>Yes</label><label><input type="radio" name="answer" value="no">No</label>
      <select name="choice"><option value="one">One</option><option value="two">Two</option></select><input type="file" name="cv" required>
      <div><span>Layout</span><button type="submit">Send</button></div></form>
      <div><button type="button" onclick="fetch('${foreignOrigin}/steal',{method:'POST',body:'no'})">Foreign write</button></div>`);
  });
  await new Promise(resolve=>portal.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${portal.address().port}`;
  let driver;
  t.after(async()=>{await driver?.close();portal.closeAllConnections();foreign.closeAllConnections();await Promise.all([new Promise(r=>portal.close(r)),new Promise(r=>foreign.close(r))]);fs.rmSync(root,{recursive:true,force:true});});
  driver=new CodexDriver({workspace:root,stateDir:path.join(root,'state'),browser:true,browserWriteOrigins:[]});
  await driver.start();
  if(!driver.list().some(row=>row.name==='browser_open')){t.skip('No installed Chromium/Edge on this runner');return;}
  const call=async(name,args={})=>driver.call(name,{...args,operationId:randomUUID()});
  await call('browser_open',{url:origin});
  const blocked=await call('browser_click',{selector:'button[type="submit"]'});
  assert.equal(blocked.isError,true);assert.equal(received,null);
  await driver.close();
  driver=new CodexDriver({workspace:root,stateDir:path.join(root,'state'),browser:true,browserWriteOrigins:[origin]});await driver.start();
  await call('browser_open',{url:origin});
  const inspection=(await call('browser_inspect')).structuredContent.result.result;
  const controls=JSON.parse(inspection.split('max 100):\n')[1].split('\n\nLinks:')[0]);
  const submit=controls.find(control=>control.text==='Send');
  assert(submit.selector.includes('nth-of-type'), 'idless button gets a real unique CSS path');
  const radio=controls.find(control=>control.name==='answer'&&control.value==='yes');
  assert.equal((await call('browser_check',{selector:radio.selector})).isError,false);
  await call('browser_fill',{selector:'input[name="name"]',value:'Fixture User'});
  await call('browser_select',{selector:'select[name="choice"]',value:'two'});
  await call('browser_upload',{selector:'input[name="cv"]',filePath:'cv.pdf'});
  await call('browser_click',{selector:'button:has-text("Foreign write")'});
  assert.equal(foreignWrites,0);
  assert.equal((await call('browser_click',{selector:submit.selector})).isError,false);
  assert(received);assert.equal(received.radio,'yes');assert.equal(received.choice,'two');assert.equal(received.name,'Fixture User');
  assert.equal(createHash('sha256').update(received.bytes).digest('hex'),createHash('sha256').update(expected).digest('hex'));
  assert.match((await call('browser_inspect')).structuredContent.result.result,/APPLICATION RECEIVED/);
});

test('persisted browser origin grants and revocations are reread for the already-open page', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'majin-dynamic-origin-'));
  const dataDir = path.join(root, 'data');
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const access = new FileAndAccessController({ dataDir, workspaceDir: workspace });
  access.enableOwnerMode({ lanes: ['browser'], folders: [workspace] });

  const submissions = [];
  const portal = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      submissions.push(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString('utf8'))));
      res.setHeader('content-type', 'text/html');
      res.end('<h1>DYNAMIC RECEIVED</h1><a href="/">Again</a>');
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<h1>Dynamic portal</h1><form method="post" action="/submit"><label>Name <input name="name" required></label><button type="submit">Send</button></form>');
  });
  await new Promise(resolve => portal.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${portal.address().port}`;

  const tools = await createDriverTools({
    workspace,
    allowedFolders: [workspace],
    grantedLanes: ['browser'],
    browser: true,
    browserWriteOrigins: [],
    browserWriteOriginsFile: access.ownerMode.file,
    browserVisible: false,
  });
  const run = async (name, args = {}) => tools.get(name).run(args);
  t.after(async () => {
    try { await run('browser_close'); } catch { /* browser may not have opened on a skipped runner */ }
    portal.closeAllConnections();
    await new Promise(resolve => portal.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  if (!tools.has('browser_open')) { t.skip('No installed Chromium/Edge on this runner'); return; }

  const succeeded = (result) => result.ok !== false && !result.error;
  assert.equal(succeeded(await run('browser_open', { url: origin })), true);
  assert.equal(succeeded(await run('browser_fill', { selector: 'input[name="name"]', value: 'Dynamic User' })), true);
  const captureError = async (promise) => {
    try { await promise; assert.fail('expected the browser action to be blocked'); }
    catch (error) { return error; }
  };
  const blocked = await captureError(run('browser_click', { selector: 'button[type="submit"]' }));
  assert.equal(blocked.code, 'BROWSER_ORIGIN_GRANT_REQUIRED');
  assert.equal(blocked.meta.ownerHandoff.origin, origin);
  assert.deepEqual(submissions, []);

  access.grantBrowserOrigins([`${origin}/submit`]);
  const statusAfterGrant = (await run('driver_status')).result;
  assert.deepEqual(statusAfterGrant.browserWriteOrigins, [origin]);
  assert.equal(succeeded(await run('browser_click', { selector: 'button[type="submit"]' })), true);
  assert.match((await run('browser_inspect')).result, /DYNAMIC RECEIVED/);
  assert.deepEqual(submissions, [{ name: 'Dynamic User' }], 'granting the origin did not require reopening or refilling the page');

  access.revokeBrowserOrigins([origin]);
  assert.equal(succeeded(await run('browser_open', { url: origin })), true);
  assert.equal(succeeded(await run('browser_fill', { selector: 'input[name="name"]', value: 'Should Not Submit' })), true);
  const blockedAfterRevoke = await captureError(run('browser_click', { selector: 'button[type="submit"]' }));
  assert.equal(blockedAfterRevoke.code, 'BROWSER_ORIGIN_GRANT_REQUIRED');
  assert.deepEqual(submissions, [{ name: 'Dynamic User' }], 'revocation is also effective without recreating the tool context');
});
