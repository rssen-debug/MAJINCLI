import test from 'node:test';
import assert from 'node:assert/strict';
import {applicationDecision,jobKey,receiptStatus} from '../../src/v5/job-application-guard.js';
const job={id:'pb-123',employer:'Example Ltd'};
test('blocks employers even with suffix',()=>{
 for(const employer of ['Atea AB','Gigstep Sverige','Poolia Rekrytering']) assert.equal(applicationDecision({...job,employer},{approvedJobIds:['pb-123']}).allowed,false);
});
test('explicitly skipped job cannot be sent',()=>assert.deepEqual(applicationDecision(job,{approvedJobIds:['pb-123'],excludedJobIds:['pb-123']}).reasons,['owner_excluded_job']));
test('requires explicit per-job approval',()=>assert.deepEqual(applicationDecision(job).reasons,['missing_explicit_job_approval']));
test('stops duplicates',()=>assert.ok(applicationDecision(job,{approvedJobIds:['pb-123'],confirmedJobIds:['pb-123']}).reasons.includes('already_submitted')));
test('allows only explicitly approved eligible job',()=>assert.equal(applicationDecision(job,{approvedJobIds:['pb-123']}).allowed,true));
test('score cannot be used as identity',()=>assert.throws(()=>jobKey({score:95,employer:'Example'})));
test('receipt requires actual evidence',()=>{
 assert.equal(receiptStatus({submitted:true,confirmationText:'Job application form'}),'pending_verification');
 assert.equal(receiptStatus({submitted:true,confirmationText:'Tack för din ansökan'}),'confirmed_received');
 assert.equal(receiptStatus({submitted:false,confirmationId:'123'}),'not_submitted');
});
