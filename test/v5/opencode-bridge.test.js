import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requiredLane, isAuthorized, filterCatalog } from '../../src/v5/opencode-bridge-policy.js';
import { createBridge, MCP_TOOLS } from '../../bin/majin-opencode-mcp.mjs';

test('maps MAJIN catalog names to owner lanes without silently exposing absent permissions', () => {
  assert.equal(requiredLane({name: 'web_fetch'}), 'web');
  assert.equal(requiredLane({name: 'shell_run'}), 'shelltools');
  assert.equal(requiredLane({name: 'browser_open'}), 'browser');
  assert.equal(requiredLane({name: 'fs_read'}), 'files');
  assert.equal(requiredLane({name: 'jobs_search'}), 'jobs');
  assert.equal(requiredLane({name: 'unknown_custom_tool'}), 'unknown');
  assert.equal(isAuthorized({name:'fs_read'}, []), false);
  assert.equal(isAuthorized({name:'majin_status'}, []), true);
  assert.deepEqual(filterCatalog([{name:'fs_read',description:'Read file'}, {name:'web_fetch',description:'Fetch url'}], ['files'], '', 20).map(x=>x.name), ['fs_read']);
});

test('OpenCode bridge reads existing grants, returns precise tool schema, denies revoked operations', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'majin-mcp-bridge-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const workspace=path.join(root,'work'), dataDir=path.join(root,'data');
  fs.mkdirSync(workspace);fs.mkdirSync(dataDir);
  let rights={lanes:['files'],folders:[workspace]};
  let called=0;
  class FakeDriver {
    constructor(options){this.options=options;this.catalog=null;}
    async start(){this.catalog=[{name:'fs_read', inputSchema:{type:'object',properties:{path:{type:'string'},operationId:{type:'string'}},required:['path','operationId']}}];}
    list(){return this.catalog;}
    async call(name,args){called++;return {content:[{type:'text',text:JSON.stringify({name,args})}],isError:false};}
    async close(){}
  }
  const b=createBridge({workspace,dataDir,Driver:FakeDriver,getOwner:()=>rights});
  t.after(()=>b.close());
  const status=await b.operate('majin_status');
  assert.equal(status.isError,false);
  assert.equal(JSON.parse(status.content[0].text).authorized,1);
  const search=await b.operate('majin_tools_search',{query:'fs'});
  assert.equal(JSON.parse(search.content[0].text).matches[0].name,'fs_read');
  const schema=JSON.parse((await b.operate('majin_tool_schema',{name:'fs_read'})).content[0].text);
  assert.deepEqual(schema.inputSchema.required,['path']);
  assert.equal('operationId' in schema.inputSchema.properties,false);
  const ok=await b.operate('majin_tool_call',{name:'fs_read',operationId:'read-fixture',arguments:{path:'example.txt'}});
  assert.equal(ok.isError,false);
  assert.equal(called,1);
  rights={lanes:[],folders:[]};
  const blocked=await b.operate('majin_tool_call',{name:'fs_read',operationId:'try-after-revoke',arguments:{path:'example.txt'}});
  assert.equal(blocked.isError,true);
  assert.equal(called,1);
  assert.equal(MCP_TOOLS.length,4);
});

test('no existing MAJIN profile means bridge fails closed',()=>{
  assert.throws(()=>createBridge({workspace:os.tmpdir(),dataDir:path.join(os.tmpdir(),'definitely-majin-no-profile-'+process.pid)}),/Existing MAJIN V5 data/);
});
