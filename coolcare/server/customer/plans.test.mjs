import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeAnnualPlan, annualPlanReminders } from './plans.mjs';

const series = {
  seriesId: 12, firstServiceDate: '2026-01-05', totalAmount: '260.00',
  unitCount: 3, includedUnits: 3, baseAnnualPrice: '260.00', additionalUnitPrice: '80.00',
};
const visits = statuses => statuses.map((status, index) => ({
  seriesId: 12, bookingId: 100 + index, visitNumber: index + 1, status,
  preferredDate: ['2026-01-05', '2026-04-06', '2026-07-06', '2026-10-05'][index],
  windowEnd: ['2026-04-05', '2026-07-05', '2026-10-05', '2027-01-05'][index],
  slotStart: '09:00:00', reference: `BK-2026-0${100 + index}`,
}));

test('annual plan usage counts quarterly bookings once and retains unfinished return obligations', () => {
  const plan = describeAnnualPlan(series, visits(['Completed', 'Completed', 'Completed', 'Awaiting return arrangement']), new Date('2027-01-06T02:00:00Z'));
  assert.equal(plan.status, 'Active');
  assert.equal(plan.completedVisits, 3);
  assert.equal(plan.remainingVisits, 1);
  assert.equal(plan.totalVisits, 4);
  assert.equal(plan.nextVisit, null);
  assert.equal(plan.totalAmount, 260);
});

test('annual plan lifecycle distinguishes completion, cancellation and expiry without fake remaining visits', () => {
  const now = new Date('2026-12-10T01:00:00Z');
  const complete = describeAnnualPlan(series, visits(['Completed', 'Completed', 'Completed', 'Completed']), now);
  assert.equal(complete.status, 'Completed');
  assert.equal(complete.canRenew, true);
  assert.equal(complete.minimumFirstDate, '2027-01-05');
  const cancelled = describeAnnualPlan(series, visits(['Cancelled', 'Rejected', 'Cancelled', 'Expired']), now);
  assert.equal(cancelled.status, 'Cancelled');
  assert.equal(cancelled.remainingVisits, 0);
  assert.equal(cancelled.unusedClosedVisits, 4);
  assert.equal(cancelled.completedVisits, 0);
  assert.equal(cancelled.canRenew, false);
  assert.equal(describeAnnualPlan(series, visits(['Expired', 'Expired', 'Expired', 'Expired']), now).status, 'Expired');
  assert.equal(describeAnnualPlan(series, visits(['Completed', 'Completed', 'Completed', 'Submitted']), new Date('2027-01-05T00:00:00Z')).status, 'Expired');
});

test('renewal opens sixty days before expiry and an existing renewal cannot renew twice', () => {
  const active = visits(['Completed', 'Completed', 'Completed', 'Submitted']);
  assert.equal(describeAnnualPlan(series, active, new Date('2026-11-05T15:59:59Z')).canRenew, false);
  assert.equal(describeAnnualPlan(series, active, new Date('2026-11-05T16:00:00Z')).canRenew, true);
  assert.equal(describeAnnualPlan({ ...series, existingRenewalSeriesId: 15 }, active, new Date('2026-12-01T00:00:00Z')).canRenew, false);
});

test('reminders use Singapore time and only the next future active quarterly visit', () => {
  const now = new Date('2026-09-29T00:00:00Z');
  const plan = describeAnnualPlan(series, visits(['Completed', 'Cancelled', 'Completed', 'Confirmed']), now);
  assert.equal(plan.nextVisit.bookingId, 103);
  assert.deepEqual(annualPlanReminders([plan], now).map(item => item.kind), ['visit']);
  const renewed = describeAnnualPlan({ ...series, existingRenewalSeriesId: 99 }, visits(['Completed', 'Completed', 'Completed', 'Completed']), new Date('2026-12-20T00:00:00Z'));
  assert.equal(annualPlanReminders([renewed], new Date('2026-12-20T00:00:00Z')).length, 0);
});
