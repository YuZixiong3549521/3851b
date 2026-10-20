import test from 'node:test';
import assert from 'node:assert/strict';
import { bookingReference, withBookingReference, parseBookingSearch } from '../server/booking-reference.mjs';

test('booking references retain the creation year and IDs longer than four digits', () => {
  assert.equal(bookingReference(1, '2024-12-31 23:59:59'), 'BK-2024-0001');
  assert.equal(bookingReference(12345, '2025-01-01T00:00:00Z'), 'BK-2025-12345');
  assert.equal(bookingReference(23, new Date('2026-02-01T00:00:00Z')), 'BK-2026-0023');
  for (const createdAt of [undefined, null, '', 'invalid', new Date(NaN)])
    assert.equal(bookingReference(1, createdAt), 'Reference unavailable');
});

test('ledger and service dates cannot supply the booking creation year', () => {
  const row = { bookingId: 1, bookingCreatedAt: '2024-12-31 12:00:00', createdAt: '2026-10-20 12:00:00', serviceDate: '2027-01-01' };
  assert.equal(withBookingReference(row).bookingReference, 'BK-2024-0001');
  assert.equal(withBookingReference({ ...row, bookingCreatedAt: null }).bookingReference, 'Reference unavailable');
  assert.equal(withBookingReference({ bookingId: 1, createdAt: '2024-12-31 12:00:00' }).bookingReference, 'BK-2024-0001');
});

test('search accepts full and legacy references without dropping the full reference year', () => {
  assert.deepEqual(parseBookingSearch(' bk-2024-0001 '), { id: 1, year: 2024 });
  for (const value of ['1', '#1', 'BK-0001', 1])
    assert.deepEqual(parseBookingSearch(value), { id: 1, year: null });
  assert.deepEqual(parseBookingSearch('BK-2025-12345'), { id: 12345, year: 2025 });
  for (const value of ['', 'Alice', 'BK-2024-', 'BK-2024-0', '#-1', '1.2', '9007199254740992'])
    assert.equal(parseBookingSearch(value), null);
});
