import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsQueueFilter } from '../server/admin-queue-filters.mjs';
import { matchesPlanAttention } from '../lib/admin-plan-filters.mjs';
import { describePlanReminder, planReminderKey } from '../lib/admin-plan-reminders.mjs';

test('renewal contact is due at the Singapore 14-day boundary and remains due when overdue', () => {
  const now = new Date('2026-12-31T16:01:00Z'); // Singapore 1 January
  const plan = { status: 'Active', validUntil: '2027-03-01', earlyRenewalDeadline: '2027-01-14T16:30:00Z' };
  assert.equal(describePlanReminder(plan, [], now).due, true);
  assert.equal(describePlanReminder({ ...plan, earlyRenewalDeadline: '2027-01-15T16:30:00Z' }, [], now).due, false);
  assert.equal(describePlanReminder({ ...plan, status: 'Expired', validUntil: '2026-12-31' }, [], now).due, true);
  for (const changed of [{ status: 'Cancelled' }, { existingRenewalSeriesId: 20 }]) assert.equal(describePlanReminder({ ...plan, ...changed }, [], now).due, false);
  const history = [{ reminderKey: planReminderKey(plan) }];
  assert.equal(describePlanReminder(plan, history, now).contacted, true);
  assert.equal(describePlanReminder(plan, history, now).due, false);
  const changed = describePlanReminder({ ...plan, earlyRenewalDeadline: '2027-01-13T16:30:00Z' }, history, now);
  assert.equal(changed.contacted, false);
  assert.equal(changed.due, true);
  assert.equal(matchesPlanAttention({ reminder: changed }, 'reminder-due', '2027-01-01'), true);
  assert.equal(matchesPlanAttention({ reminder: { due: true, dueDate: '2026-12-31' } }, 'reminder-overdue', '2027-01-01'), true);
  assert.equal(matchesPlanAttention({ reminder: { due: true, dueDate: '2027-01-01' } }, 'reminder-overdue', '2027-01-01'), false);
  assert.equal(matchesPlanAttention({ reminder: { due: false, dueDate: '2026-12-31' } }, 'reminder-overdue', '2027-01-01'), false);
});

test('overview queue bounds include the whole Monday-to-Sunday week across years', () => {
  assert.deepEqual(operationsQueueFilter('completed-week', '2027-01-03').values, ['2026-12-28', '2027-01-03']);
  assert.deepEqual(operationsQueueFilter('completed-week', '2027-01-04').values, ['2027-01-04', '2027-01-10']);
  assert.deepEqual(operationsQueueFilter('today', '2026-11-01').values, ['2026-11-01']);
  assert.equal(operationsQueueFilter('unknown'), null);
});

test('annual plan attention excludes cancelled/renewed plans and includes exact deadline boundaries', () => {
  const plan = { status: 'Active', validUntil: '2026-12-01', canRenew: true, existingRenewalSeriesId: null, earlyRenewalEligible: true, earlyRenewalDeadline: '2026-11-14T16:30:00Z' };
  assert.equal(matchesPlanAttention(plan, 'expiring', '2026-11-01'), true);
  assert.equal(matchesPlanAttention({ ...plan, existingRenewalSeriesId: 12 }, 'expiring', '2026-11-01'), false);
  assert.equal(matchesPlanAttention({ ...plan, status: 'Cancelled' }, 'unrenewed', '2026-11-01'), false);
  assert.equal(matchesPlanAttention({ ...plan, earlyRenewalEligible: false }, 'bonus-soon', '2026-11-01'), false);
  assert.equal(matchesPlanAttention(plan, 'bonus-soon', '2026-11-01'), true);
  assert.equal(matchesPlanAttention({ ...plan, earlyRenewalDeadline: '2026-11-15T16:30:00Z' }, 'bonus-soon', '2026-11-01'), false);
});
