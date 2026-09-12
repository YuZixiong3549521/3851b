import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingReference, createBookingSchema } from './booking-service.mjs';
import { exceedsWeeklyLimit, normalizeAddress } from './booking-options.mjs';

test('booking reference is stable and padded', () => {
  assert.equal(bookingReference(23, '2026-09-07 10:00:00'), 'BK-2026-0023');
});

test('booking input accepts the customer MVP payload', () => {
  const result = createBookingSchema.safeParse({
    serviceId: 2,
    addressId: 1,
    unitIds: [1, 2],
    preferredDate: '2026-09-18',
    timeSlot: '09:00 - 11:00',
    problemDescription: 'Water leakage from the living room unit.',
  });
  assert.equal(result.success, true);
});

test('booking input rejects an empty aircon selection', () => {
  const result = createBookingSchema.safeParse({
    serviceId: 2,
    addressId: 1,
    unitIds: [],
    preferredDate: '2026-09-18',
    timeSlot: '09:00 - 11:00',
  });
  assert.equal(result.success, false);
});

test('rolling seven-day quota includes cross-week boundaries without imposing advance notice', () => {
  assert.equal(exceedsWeeklyLimit([], '2026-09-18'),false);
  assert.equal(exceedsWeeklyLimit(['2026-09-18'], '2026-09-18'),false);
  assert.equal(exceedsWeeklyLimit(['2026-09-18','2026-09-18'], '2026-09-18'),true);
  assert.equal(exceedsWeeklyLimit(['2026-09-12','2026-09-14'], '2026-09-18'),true);
  assert.equal(exceedsWeeklyLimit(['2026-09-12','2026-09-14'], '2026-09-19'),false);
  assert.equal(exceedsWeeklyLimit(['2026-09-15','2026-09-21'], '2026-09-18'),true);
  assert.equal(exceedsWeeklyLimit(['2026-09-12','2026-09-24'], '2026-09-18'),false);
  assert.equal(exceedsWeeklyLimit(['2026-12-29','2027-01-01'], '2027-01-03'),true);
});

test('address normalization ignores formatting while preserving unit separators', () => {
  assert.equal(normalizeAddress(' 123 Main Street, #01-02 '),normalizeAddress('１２３ MAIN STREET #01-02'));
  assert.notEqual(normalizeAddress('123 Main Street #01-02'),normalizeAddress('123 Main Street #01-03'));
  assert.notEqual(normalizeAddress('123 Main Street #1-23'),normalizeAddress('123 Main Street #12-3'));
});
