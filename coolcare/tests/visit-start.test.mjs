import test from 'node:test';
import assert from 'node:assert/strict';
import {visitStartBlockReason} from '../server/visit-start.mjs';
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
