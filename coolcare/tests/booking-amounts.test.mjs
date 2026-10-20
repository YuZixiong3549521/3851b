import test from 'node:test';
import assert from 'node:assert/strict';
import { mapBookingAmounts } from '../server/booking-amounts.mjs';

test('pending totals include extras and only active reserved rewards', () => {
  const row = { baseAmount: '100.00', additionalFee: '25.99', discount: '5.00', rewardStatus: 'Reserved' };
  assert.equal(mapBookingAmounts(row).grossAmount, 125.99);
  assert.equal(mapBookingAmounts(row).netServiceAmount, 120.99);
  assert.equal(mapBookingAmounts({ ...row, rewardStatus: 'Released' }).netServiceAmount, 125.99);
  assert.equal(mapBookingAmounts({ ...row, baseAmount: null }).netServiceAmount, null);
});

test('completed values stay frozen and do not invent missing historical splits', () => {
  const row = { completionOutcome: 'Awarded', completedGrossAmount: '125.99', completedDiscount: '5',
    completedNetAmount: '120.99', awardedPoints: 120, baseAmount: 900, additionalFee: 50 };
  const mapped = mapBookingAmounts(row);
  assert.equal(mapped.netServiceAmount, 120.99);
  assert.equal(mapped.baseAmount, null);
  assert.equal(mapped.additionalFee, null);
  assert.equal(mapped.awardedPoints, 120);
  const unknown = mapBookingAmounts({ ...row, completionOutcome: 'Unknown price', completedGrossAmount: null, completedNetAmount: null });
  assert.equal(unknown.grossAmount, null);
  assert.equal(unknown.netServiceAmount, null);
});
