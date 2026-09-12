import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the browser's actual pure TypeScript helper under the Node 22+ test runner.
const source = await readFile(new URL('../lib/customer-bookings.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { upcomingBookings, nextUpcomingBooking, isActiveBooking, sortBookingsByService, groupCustomerBookings } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const booking = (bookingId, preferredDate, timeSlot = '09:00 - 11:00', status = 'Submitted') => ({ bookingId, preferredDate, timeSlot, status });

test('upcoming count and nearest appointment share a sorted future set without mutating source order', () => {
  const bookings = [booking(3, '2026-10-15'), booking(1, '2026-09-13'), booking(2, '2026-09-16'), booking(4, '2026-09-11')];
  const now = new Date('2026-09-12T04:00:00Z');
  assert.deepEqual(upcomingBookings(bookings, now).map(item => item.bookingId), [1, 2, 3]);
  assert.equal(nextUpcomingBooking(bookings, now).bookingId, 1);
  assert.deepEqual(bookings.map(item => item.bookingId), [3, 1, 2, 4]);
  assert.equal(isActiveBooking(bookings[3]), true, 'overdue unfinished requests remain Active');
  assert.equal(upcomingBookings(bookings, now)[0].preferredDate, '2026-09-13', 'existing weekend bookings remain visible');
});

test('Singapore midnight rollover and appointment starts use instants rather than browser-local dates', () => {
  const bookings = [booking(1, '2026-09-12', '23:59 - 23:59'), booking(2, '2026-09-13', '12:00 AM - 02:00 AM')];
  assert.deepEqual(upcomingBookings(bookings, new Date('2026-09-12T15:58:00Z')).map(item => item.bookingId), [1, 2]);
  assert.deepEqual(upcomingBookings(bookings, new Date('2026-09-12T16:00:00Z')).map(item => item.bookingId), [2]);
  assert.deepEqual(upcomingBookings(bookings, new Date('2026-09-12T16:00:01Z')), []);
});

test('same-day arrival windows that have started are excluded, including ongoing visits', () => {
  const bookings = [booking(3, '2026-09-14', '14:00 - 16:00'), booking(1, '2026-09-14', '09:00 - 11:00', 'In Progress'), booking(2, '2026-09-14', '11:00 - 13:00')];
  assert.deepEqual(upcomingBookings(bookings, new Date('2026-09-14T02:00:00Z')).map(item => item.bookingId), [2, 3]);
  assert.equal(isActiveBooking(bookings[1]), true);
  assert.deepEqual(upcomingBookings(bookings, new Date('2026-09-14T03:00:01Z')).map(item => item.bookingId), [3]);
});

test('12-hour and 24-hour slots sort together, including midnight, noon and deterministic ties', () => {
  const bookings = [booking(7, '2026-09-14', '02:00 PM - 04:00 PM'), booking(3, '2026-09-14', '12:00 PM - 02:00 PM'), booking(1, '2026-09-14', '12:00 AM - 02:00 AM'), booking(2, '2026-09-14', '09:00 AM - 11:00 AM'), booking(6, '2026-09-14', '14:00 - 16:00')];
  assert.deepEqual(upcomingBookings(bookings, '2026-09-14').map(item => item.bookingId), [1, 2, 3, 6, 7]);
  assert.equal(nextUpcomingBooking(bookings, new Date('2026-09-14T04:00:01Z')).bookingId, 6);
});

test('completed, cancelled and invalid schedules cannot become an upcoming appointment', () => {
  const bookings = [booking(1, '2026-09-14', '09:00 - 11:00', 'Completed'), booking(2, '2026-09-14', '09:00 - 11:00', 'Cancelled'), booking(3, '2026-09-14', '09:00 - 11:00', 'canceled'), booking(4, '2026-09-14', '25:00 - 26:00'), booking(5, '2026-09-14', '13:00 PM - 02:00 PM'), booking(6, '2026-02-30'), booking(7, '2026-09-14', '09:60 - 11:00'), booking(8, '2026-09-14', 'Time to be confirmed')];
  assert.deepEqual(upcomingBookings(bookings, '2026-01-01'), []);
  assert.equal(nextUpcomingBooking(bookings, '2026-01-01'), undefined);
});

test('active orders use service chronology rather than newest insertion, preserving unfinished past dates', () => {
  const orders = [booking(279, '2027-06-28'), booking(276, '2026-09-28'), booking(3, '2026-09-18'), booking(4, '2026-09-10')];
  assert.deepEqual(sortBookingsByService(orders).map(row => row.bookingId), [4, 3, 276, 279]);
  assert.deepEqual(orders.map(row => row.bookingId), [279, 276, 3, 4]);
});

test('annual groups use purchased series identity and the earliest visible visit, not a shared package name', () => {
  const orders = [
    {...booking(9, '2027-03-28'), annualBundle: {seriesId: 22}},
    {...booking(4, '2026-10-28'), annualBundle: {seriesId: 23}},
    booking(1, '2026-09-18'),
    {...booking(3, '2026-09-28'), annualBundle: {seriesId: 22}},
  ];
  assert.deepEqual(groupCustomerBookings(orders).map(group => [group.key, group.bookings.map(row => row.bookingId)]), [
    ['booking-1', [1]], ['annual-22', [3, 9]], ['annual-23', [4]],
  ]);
  assert.equal(groupCustomerBookings(orders)[1].annual, true);
});
