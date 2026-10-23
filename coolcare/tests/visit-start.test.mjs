import test from 'node:test';
import assert from 'node:assert/strict';
import {visitStartBlockReason,visitCompletionBlockReason,serviceTimingTestMode} from '../server/visit-start.mjs';
test('visit start uses the Singapore date and appointment start, with no lateness cutoff',()=>{
 const now=new Date('2026-10-20T01:00:00.000Z');
 assert.equal(visitStartBlockReason('2026-10-20','09:00:00',now),null);
 assert.match(visitStartBlockReason('2026-10-21','09:00:00',now),/scheduled date/);
 assert.match(visitStartBlockReason('2026-10-19','09:00:00',now),/passed/);
 assert.match(visitStartBlockReason('2026-10-20','09:01:00',now),/before/);
 assert.equal(visitStartBlockReason('2026-10-20','09:00:00',new Date('2026-10-20T15:59:00Z')),null);
 assert.match(visitStartBlockReason('2026-10-20','09:00:00',new Date('2026-10-20T16:00:00Z')),/passed/);
 assert.match(visitStartBlockReason('2026-10-20','09:00:00',now,41),/WO-41/);
 assert.match(visitStartBlockReason('2026-10-20',null,now),/no scheduled start/);
});

function withEnvironment(values, run) {
 const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
 try { Object.assign(process.env,values); run(); }
 finally { for(const [key,value] of Object.entries(previous)) { if(value===undefined)delete process.env[key]; else process.env[key]=value; } }
}

test('service timing test mode requires explicit opt-in and is disabled in production',()=>{
 assert.equal(serviceTimingTestMode({}),false);
 assert.equal(serviceTimingTestMode({SERVICE_TIMING_TEST_MODE:'false'}),false);
 assert.equal(serviceTimingTestMode({SERVICE_TIMING_TEST_MODE:'true',NODE_ENV:'development'}),true);
 assert.equal(serviceTimingTestMode({SERVICE_TIMING_TEST_MODE:'true',NODE_ENV:'production'}),false);
 withEnvironment({SERVICE_TIMING_TEST_MODE:'true',NODE_ENV:'production'},()=>{
  const now=new Date('2026-10-20T01:00:00Z');
  assert.match(visitStartBlockReason('2027-01-01','09:00:00',now),/scheduled date/);
  assert.match(visitCompletionBlockReason('2027-01-01',now),/future service/);
 });
});

test('local test mode relaxes timing but still requires a schedule and no other active job',()=>{
 withEnvironment({SERVICE_TIMING_TEST_MODE:'true',NODE_ENV:'development'},()=>{
  const now=new Date('2026-10-20T01:00:00Z');
  for(const date of ['2026-10-19','2026-10-20','2027-01-01']) {
   assert.equal(visitStartBlockReason(date,'14:00:00',now),null);
   assert.equal(visitCompletionBlockReason(date,now),null);
  }
  assert.match(visitStartBlockReason('2027-01-01','09:00:00',now,41),/WO-41/);
  assert.match(visitStartBlockReason('2027-01-01',null,now),/no scheduled start/);
 });
});
