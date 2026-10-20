import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingConfirmationDeadline, bookingExpiryDate, assertBookingNotExpired } from '../server/order-expiry.mjs';

const deadline = new Date('2026-10-20T02:00:00Z');
const annualVisit = visitNumber => ({
  execute: async sql => sql.includes('annual_booking_visit')
    ? [visitNumber == null ? [] : [{ visit_number: visitNumber }]]
    : [[{ expired: 1 }]],
});

test('only standalone requests and the first annual visit receive a confirmation deadline after rescheduling', async () => {
  assert.equal(await bookingConfirmationDeadline(annualVisit(null), 1, deadline), bookingExpiryDate(deadline));
  assert.equal(await bookingConfirmationDeadline(annualVisit(1), 1, deadline), bookingExpiryDate(deadline));
  for (const number of [2, 3, 4]) {
    assert.equal(await bookingConfirmationDeadline(annualVisit(number), 1, deadline), null);
  }
});

test('legacy deadlines cannot invalidate later annual entitlements but initial expired requests remain blocked', async () => {
  const booking = { booking_id: 42, booking_status: 'Submitted', expires_at: '2026-10-18 02:00:00' };
  await assert.rejects(assertBookingNotExpired(annualVisit(null), booking), error => error.status === 409);
  await assert.rejects(assertBookingNotExpired(annualVisit(1), booking), error => error.status === 409);
  await assertBookingNotExpired(annualVisit(2), booking);
  await assertBookingNotExpired(annualVisit(4), booking);
});
