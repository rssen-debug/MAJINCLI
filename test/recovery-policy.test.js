import test from 'node:test';
import assert from 'node:assert/strict';
import { recoveryDecision } from '../src/core/recovery-policy.js';
test('verified evidence allows a completed step to be skipped',()=>{
 assert.equal(recoveryDecision({status:'verified',evidence:'sha256:abc',risk:'write'}).action,'skip');
});
test('uncertain outcomes must be inspected before retry',()=>{
 assert.equal(recoveryDecision({status:'running',risk:'read'}).action,'inspect');
 assert.equal(recoveryDecision({status:'uncertain',risk:'external'}).action,'inspect');
});
test('side effects require approval and pending reads can resume',()=>{
 assert.equal(recoveryDecision({status:'pending',risk:'destructive'}).action,'approval');
 assert.equal(recoveryDecision({status:'pending',risk:'external'}).action,'approval');
 assert.equal(recoveryDecision({status:'pending',risk:'read'}).action,'resume');
});
test('missing and unknown statuses never resume automatically',()=>{
 assert.equal(recoveryDecision(null).action,'inspect');
 assert.equal(recoveryDecision({status:'unknown'}).action,'inspect');
});
