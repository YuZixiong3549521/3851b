import assert from 'node:assert/strict';
import test from 'node:test';
import { bookingReference, createBooking, createBookingSchema } from './booking-service.mjs';

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

test('creating a booking commits the booking, unit link and first status', async () => {
  const calls = [];
  const connection = {
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    execute: async (sql) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      if (sql.includes('FROM customer c')) return [[{ customerId: 1, userId: 1, fullName: 'Alice Tan' }]];
      if (sql.includes('FROM service_catalog')) return [[{ serviceId: 2, serviceName: 'Chemical Wash', basePrice: 120 }]];
      if (sql.includes('FROM service_address')) return [[{ address_id: 1 }]];
      if (sql.includes('FROM aircon_unit')) return [[{ unit_id: 1 }]];
      if (sql.includes('INSERT INTO booking_status_history')) return [{ affectedRows: 1 }];
      if (sql.includes('INSERT INTO booking')) return [{ insertId: 9 }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    query: async (sql) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      return [{ affectedRows: 1 }];
    },
  };
  const fakePool = { getConnection: async () => connection };
  const future = new Date();
  future.setDate(future.getDate() + 14);

  const booking = await createBooking(fakePool, {
    serviceId: 2,
    addressId: 1,
    unitIds: [1],
    preferredDate: future.toISOString().slice(0, 10),
    timeSlot: '09:00 - 11:00',
    problemDescription: 'Water leakage.',
  });

  assert.equal(booking.bookingId, 9);
  assert.equal(booking.status, 'Submitted');
  assert.equal(booking.totalAmount, 120);
  assert.equal(calls.includes('commit'), true);
  assert.equal(calls.includes('rollback'), false);
  assert.equal(calls.includes('release'), true);
  assert.equal(calls.some((call) => call.startsWith('INSERT INTO booking_aircon_unit')), true);
  assert.equal(calls.some((call) => call.startsWith('INSERT INTO booking_status_history')), true);
});
