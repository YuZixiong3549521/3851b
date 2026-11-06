import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourseworkPlan } from '../database/coursework-data.mjs';
import { courseworkRequestId, validateCourseworkOptions } from '../scripts/coursework-import.mjs';
import { addCalendarDays, isWeekday } from '../server/customer/booking-schedule.mjs';

test('coursework plan is deterministic, clearly synthetic and useful for historical and upcoming demonstrations', () => {
  const options = { asOf: '2026-11-06', batchKey: 'coursework-test-plan' };
  const plan = buildCourseworkPlan(options);
  assert.deepEqual(buildCourseworkPlan(options), plan);
  assert.equal(plan.bookings.length, 50);
  assert.equal(new Set(plan.bookings.map(row => row.key)).size, 50);
  assert.equal(plan.annualPlans.length, 3);
  assert.equal(plan.customers.length, 12);
  assert.equal(plan.technicians.length, 3);
  for (const account of [...plan.customers, ...plan.technicians]) {
    assert.match(account.email, /@example\.test$/);
    assert.match(account.name, /synthetic/i);
  }
  const statuses = new Set(plan.bookings.map(row => row.status));
  for (const status of ['Completed', 'Submitted', 'Confirmed', 'Assigned', 'Cancelled', 'Rejected', 'Expired']) assert.ok(statuses.has(status), status);
  assert.ok(plan.bookings.filter(row => row.status === 'Completed').length >= 20);
  assert.ok(new Set(plan.bookings.filter(row => row.status === 'Completed').map(row => row.date.slice(0, 4))).size >= 2, 'year comparison needs historical orders in more than one year');
  for (const booking of plan.bookings) {
    assert.ok(isWeekday(booking.date), `${booking.key} must be a working day`);
    if (['Submitted', 'Confirmed', 'Assigned'].includes(booking.status)) assert.ok(booking.date >= addCalendarDays(options.asOf, 14), `${booking.key} needs booking notice`);
    if (booking.status === 'Completed') assert.ok(booking.date < options.asOf, 'completed examples are historical');
  }
  for (const annual of plan.annualPlans) {
    const visits = plan.bookings.filter(row => row.annualKey === annual.key);
    assert.equal(visits.length, 4);
    assert.deepEqual(visits.map(row => row.visitNumber).sort(), [1, 2, 3, 4]);
  }
});

test('coursework batch identity survives retries but never accepts invalid dates or path-like batch names', () => {
  const first = courseworkRequestId('coursework-test-1');
  assert.equal(first, courseworkRequestId('coursework-test-1'));
  assert.notEqual(first, courseworkRequestId('coursework-test-2'));
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  for (const batchKey of ['', 'x', '../live', 'unsafe key', 'x'.repeat(65)]) {
    assert.throws(() => validateCourseworkOptions({ batchKey, asOf: '2026-11-06' }));
    assert.throws(() => buildCourseworkPlan({ batchKey, asOf: '2026-11-06' }));
  }
  for (const asOf of ['2026-02-30', '2026-13-01', 'not-a-date', '1900-01-01', '2099-01-01']) {
    assert.throws(() => validateCourseworkOptions({ batchKey: 'coursework-test', asOf }));
    assert.throws(() => buildCourseworkPlan({ batchKey: 'coursework-test', asOf }));
  }
});

test('coursework schedules stay on working days with adequate notice across year and leap-day boundaries', () => {
  for (const asOf of ['2003-01-01', '2026-01-01', '2028-02-29', '2026-12-31', '2090-12-31']) {
    const plan = buildCourseworkPlan({ asOf, batchKey: 'calendar-boundary-test' });
    assert.equal(plan.bookings.length, 50);
    for (const booking of plan.bookings) {
      assert.ok(isWeekday(booking.date), `${asOf}: ${booking.key} falls on a weekend`);
      if (['Submitted', 'Confirmed', 'Assigned'].includes(booking.status)) assert.ok(booking.date >= addCalendarDays(asOf, 14));
      if (booking.status === 'Completed') assert.ok(booking.date < asOf);
    }
  }
});
