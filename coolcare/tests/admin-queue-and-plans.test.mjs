import test from 'node:test';
import assert from 'node:assert/strict';
import { operationsQueueFilter } from '../server/admin-queue-filters.mjs';
import { matchesPlanAttention } from '../lib/admin-plan-filters.mjs';

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
