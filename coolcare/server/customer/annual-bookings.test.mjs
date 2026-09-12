import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarMonths,annualVisitSchedule } from './annual-bookings.mjs';

test('quarterly visits clamp month ends and move weekends to Monday without shifting windows',()=>{
  const rollover=annualVisitSchedule('2028-01-31',260);
  assert.deepEqual(rollover.map(visit=>visit.preferredDate),['2028-01-31','2028-05-01','2028-07-31','2028-10-31']);
  assert.equal(rollover[1].windowStart,'2028-04-30');assert.equal(rollover[1].windowEnd,'2028-07-31');
  assert.equal(annualVisitSchedule('2026-10-30',180)[1].preferredDate,'2027-02-01');
  assert.deepEqual(annualVisitSchedule('2027-11-30',180).map(visit=>visit.preferredDate),['2027-11-30','2028-02-29','2028-05-30','2028-08-30']);
  assert.equal(addCalendarMonths('2028-02-29',12),'2029-02-28');
  const schedule=annualVisitSchedule('2028-01-31',180.03);
  assert.deepEqual(schedule.map(visit=>visit.totalAmount),[45,45,45,45.03]);
  assert.equal(Math.round(schedule.reduce((sum,visit)=>sum+visit.totalAmount,0)*100),18003);
  assert.equal(schedule[0].windowEnd,schedule[1].windowStart);
  assert.equal(schedule[3].windowEnd,'2029-01-31');
  assert.throws(()=>annualVisitSchedule('2027-02-30',180),error=>error.status===400);
});

test('annual scheduling rejects a final quarterly window beyond the four-digit calendar',()=>{
  assert.throws(()=>annualVisitSchedule('9999-12-31',180),error=>error.status===400);
  assert.throws(()=>annualVisitSchedule('9999-01-01',180),error=>error.status===400);
  const valid=annualVisitSchedule('9998-12-31',180);
  assert.equal(valid[3].windowEnd,'9999-12-31');
  assert.equal(valid.length,4);
});
