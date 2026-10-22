import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPreview } from '../src/core/recovery-preview.js';
test('preview never executes and lists safe recovery decisions',()=>{
 const result=recoveryPreview({state:{steps:[{id:'a',status:'pending',risk:'read'},{id:'b',status:'running',risk:'external'}]}});
 assert.deepEqual(result.steps.map(s=>s.action),['resume','inspect']);
});
test('preview rejects oversized or missing step collections',()=>{
 assert.equal(recoveryPreview({}).ready,false);
 assert.equal(recoveryPreview({state:{steps:Array.from({length:1001},()=>({}))}}).ready,false);
});
