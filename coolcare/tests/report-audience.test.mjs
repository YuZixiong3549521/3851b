import test from 'node:test';
import assert from 'node:assert/strict';
import { audiencePeriods, annualVisitSummary, ratingBand } from '../server/report-audience.mjs';

test('customer counts deduplicate recurring orders per period and range; feedback keeps neutral and empty quarters', () => {
  const result=audiencePeriods([
    {customerId:1,serviceDate:'2026-01-02'}, {customerId:1,serviceDate:'2026-03-01'},
    {customerId:1,serviceDate:'2026-04-01'}, {customerId:2,serviceDate:'2026-04-02'},
    {customerId:3,serviceDate:'2025-12-31'},
  ], [{date:'2026-03-31'},{date:'2026-04-01'}],
  [{date:'2026-01-01',stars:5},{date:'2026-03-31',stars:3},{date:'2026-04-01',stars:1},{date:'2027-01-01',stars:4}],
  {from:'2026-01-01',to:'2026-09-30',groupBy:'quarter'});
  assert.deepEqual(result.customers,{newInPeriod:2,withBookings:2});
  assert.deepEqual(result.periods.map(r=>[r.newCustomers,r.bookingCustomers,r.positive,r.neutral,r.negative]),[[1,1,1,1,0],[1,2,0,0,1],[0,0,0,0,0]]);
  assert.deepEqual([1,2,3,4,5].map(ratingBand),['negative','negative','neutral','positive','positive']);
});

test('four entitlements stay separate from report scope and closed visits never become awaiting', () => {
  const rows=['Completed','Completed','Assigned','In Progress'].map((status,i)=>({seriesId:1,bookingId:i+10,bookingCreatedAt:'2026-01-01',customerName:'Example',address:'Example address',visitNumber:i+1,date:'2026-01-01',status}));
  const [p]=annualVisitSummary(rows,new Set([10,11]));
  assert.equal(p.totalVisits,4);assert.equal(p.completed,2);assert.equal(p.awaiting,2);assert.equal(p.selectedVisits,2);assert.equal(p.closed,0);
  assert.equal(p.visits[2].included,false);assert.equal(p.visits[2].reference,'BK-2026-0012');
  const [closed]=annualVisitSummary([{...rows[0],status:'Rejected'}],new Set());
  assert.equal(closed.recordedVisits,1);assert.equal(closed.awaiting,0);assert.equal(closed.closed,1);
});
