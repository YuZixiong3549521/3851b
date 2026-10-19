import { test } from 'node:test';
import assert from 'node:assert/strict';
import {minimumReturnDate, assertReturnDate} from '../server/customer/booking-schedule.mjs';
const now = new Date('2026-10-19T04:00:00Z');
test('return visits use the later of original service plus 14 days and today plus 14 days', () => {
  assert.equal(minimumReturnDate('2026-11-04', now), '2026-11-18');
  assert.throws(() => assertReturnDate('2026-11-02', '2026-11-04', now));
  assert.throws(() => assertReturnDate('2026-11-17', '2026-11-04', now));
  assert.doesNotThrow(() => assertReturnDate('2026-11-18', '2026-11-04', now));
  assert.equal(minimumReturnDate('2026-10-01', now), '2026-11-02');
});
test('return visits exclude weekends and retain Singapore calendar-day boundaries', () => {
  assert.equal(minimumReturnDate('2026-11-07', now), '2026-11-23');
  assert.throws(() => assertReturnDate('2026-11-21', '2026-11-04', now));
  assert.equal(minimumReturnDate('2026-10-01', new Date('2026-10-19T16:00:00Z')), '2026-11-03');
});
