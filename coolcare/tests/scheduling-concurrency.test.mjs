import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peakConcurrentReservations } from '../server/scheduling.mjs';

test('duration capacity measures simultaneous work instead of adding sequential visits', () => {
  const existing = [
    { start: '09:00:00', end: '09:45:00' },
    { start: '10:00:00', end: '10:45:00' },
  ];
  assert.equal(peakConcurrentReservations(existing, '09:00:00', '11:00:00'), 1);
  assert.equal(
    peakConcurrentReservations(
      [...existing, { start: '09:30:00', end: '10:15:00' }],
      '09:00:00',
      '11:00:00',
    ),
    2,
  );
});

test('adjacent appointments and intervals outside the requested time do not overlap', () => {
  assert.equal(
    peakConcurrentReservations(
      [
        { start: '09:00:00', end: '09:45:00' },
        { start: '09:45:00', end: '10:30:00' },
      ],
      '09:00:00',
      '11:00:00',
    ),
    1,
  );
  assert.equal(
    peakConcurrentReservations(
      [
        { start: '09:00:00', end: '09:45:00' },
        { start: '10:30:00', end: '11:00:00' },
      ],
      '09:45:00',
      '10:30:00',
    ),
    0,
  );
  assert.equal(
    peakConcurrentReservations(
      [{ start: '08:00:00', end: '18:00:00' }],
      '09:00:00',
      '11:00:00',
    ),
    1,
  );
});
