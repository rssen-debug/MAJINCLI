import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkpointPath,saveCheckpoint,loadCheckpoint } from '../src/core/checkpoint-store.js';

test('atomic checkpoint roundtrip and replacement', t => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-checkpoint-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.equal(loadCheckpoint(dir,'task_1'),null);
 saveCheckpoint(dir,'task_1',{step:1});
 assert.equal(loadCheckpoint(dir,'task_1').state.step,1);
 saveCheckpoint(dir,'task_1',{step:2});
 assert.equal(loadCheckpoint(dir,'task_1').state.step,2);
 assert.deepEqual(fs.readdirSync(dir),['task_1.json']);
});
test('checkpoint ids cannot escape storage folder',()=>{
 assert.throws(()=>checkpointPath('/tmp','../oops'),/Invalid checkpoint/);
 assert.throws(()=>checkpointPath('/tmp',''),/Invalid checkpoint/);
});
test('checkpoint size and schema are bounded',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-checkpoint-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 assert.throws(()=>saveCheckpoint(dir,'huge',{value:'x'.repeat(1100000)}),/too large/);
 fs.writeFileSync(checkpointPath(dir,'bad'),JSON.stringify({schema:4,id:'bad',state:{}}));
 assert.throws(()=>loadCheckpoint(dir,'bad'),/Invalid checkpoint schema/);
});

test('checkpoint rejects oversize input before reading or parsing',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'majin-checkpoint-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 fs.writeFileSync(checkpointPath(dir,'too_big'),'x'.repeat(1100000));
 assert.throws(()=>loadCheckpoint(dir,'too_big'),/Invalid checkpoint file size/);
});
