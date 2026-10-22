import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryPreview } from '../src/core/recovery-preview.js';
test('preview never executes and lists safe recovery decisions',()=>{
 const result=recoveryPreview({schema:1,id:'demo',state:{steps:[{id:'a',status:'pending',risk:'read'},{id:'b',status:'running',risk:'external'}]}});
 assert.deepEqual(result.steps.map(s=>s.action),['resume','inspect']);
});
test('preview rejects oversized or missing step collections',()=>{
 assert.equal(recoveryPreview({}).ready,false);
 assert.equal(recoveryPreview({schema:1,id:'demo',state:{steps:Array.from({length:1001},()=>({}))}}).ready,false);
});

test('preview refuses duplicate or invalid step identifiers',()=>{
 const base={status:'pending',risk:'read'};
 assert.deepEqual(recoveryPreview({schema:1,id:'demo',state:{steps:[{...base,id:'same'},{...base,id:'same'}]}}),{ready:false,reason:'invalid-or-duplicate-step-id',steps:[]});
 assert.equal(recoveryPreview({schema:1,id:'demo',state:{steps:[{...base,id:'../bad'}]}}).ready,false);
});

test('recovery preview summarizes decisions without invoking actions',()=>{
 const result=recoveryPreview({schema:1,id:'demo',state:{steps:[
  {id:'read_1',status:'pending',risk:'read'},
  {id:'write_1',status:'pending',risk:'write'},
  {id:'unknown_1',status:'running',risk:'external'}
 ]}});
 assert.equal(result.ready,true);
 assert.deepEqual(result.counts,{resume:1,skip:0,inspect:1,approval:1});
});

test('preview rejects envelopes without checkpoint identity',()=>{
 assert.equal(recoveryPreview({state:{steps:[]}}).reason,'invalid-checkpoint');
});

test('preview rejects traversal-style checkpoint identities',()=>{
 assert.equal(recoveryPreview({schema:1,id:'../other',state:{steps:[]}}).reason,'invalid-checkpoint');
});

test('preview produces only known recovery actions',()=>{
 const result=recoveryPreview({schema:1,id:'safe',state:{steps:[{id:'step_1',status:'pending',risk:'read'}]}});
 assert.equal(result.ready,true);
 assert.deepEqual(result.counts,{resume:1,skip:0,inspect:0,approval:0});
 assert.ok(result.steps.every(step=>['resume','skip','inspect','approval'].includes(step.action)));
});

test('preview rejects array and scalar checkpoint states',()=>{
 for(const state of [[], 'bad', 123, null]) {
  assert.equal(recoveryPreview({schema:1,id:'valid',state}).ready,false);
 }
});

test('preview safely handles missing and null state',()=>{
 assert.equal(recoveryPreview({schema:1,id:'demo'}).reason,'invalid-state');
 assert.equal(recoveryPreview({schema:1,id:'demo',state:null}).reason,'invalid-state');
});
