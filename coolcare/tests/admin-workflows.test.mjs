import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  postalProximity,
  compareDispatchCandidates,
  addDispatchProximity,
  travelLaborCost,
} from '../server/postal-proximity.mjs';
import { bookingExpiryDate } from '../server/order-expiry.mjs';
import {
  normalizeTravelBuffer,
  travelStartTime,
} from '../server/travel-planning.mjs';

test('postal dispatch treats postal sectors as categories, never numerical distance', () => {
  assert.equal(postalProximity('238839', '238839').rank, 0);
  assert.equal(postalProximity('238839', '239999').rank, 1);
  assert.equal(postalProximity('239999', '240000').rank, 2);
  assert.equal(postalProximity('238839', null).basis, 'unknown');
  assert.equal(postalProximity('238839', 'invalid').rank, 3);
  const ranked = [
    { technicianId: 1, dailyJobs: 0, proximity: { rank: 3 } },
    { technicianId: 2, dailyJobs: 1, proximity: { rank: 1 } },
    { technicianId: 3, dailyJobs: 0, proximity: { rank: 1 } },
  ].sort(compareDispatchCandidates);
  assert.deepEqual(
    ranked.map((row) => row.technicianId),
    [3, 2, 1],
  );
});

test('dispatch origin prefers the preceding visit and falls back to a recorded base', async () => {
  const connection = {
    execute: async (sql, args) =>
      sql.includes('SELECT postal_code')
        ? [[{ postal_code: '238839' }]]
        : args[0] === 1
          ? [[{ postalCode: '238831', bookingId: 55 }]]
          : [[]],
  };
  const result = await addDispatchProximity(
    connection,
    {
      address_id: 1,
      booking_id: 99,
      preferred_service_date: '2027-01-04',
      slot_start: '14:00:00',
    },
    [
      { technicianId: 1, basePostalCode: '520123', hourlyLaborCost: 30 },
      { technicianId: 2, basePostalCode: '238839', hourlyLaborCost: 40 },
      { technicianId: 3 },
    ],
  );
  assert.equal(result[0].proximity.origin, 'Previous visit that day');
  assert.equal(result[0].proximity.rank, 1);
  assert.equal(result[1].proximity.origin, 'Technician base');
  assert.equal(result[1].proximity.rank, 0);
  assert.equal(result[2].proximity.basis, 'unknown');
  assert.equal(result[0].travelPlan.bufferMinutes, 30);
  assert.equal(result[0].travelPlan.estimatedLaborCost, 15);
});

test('travel planning defaults to thirty minutes and produces auditable labour cost', () => {
  assert.equal(normalizeTravelBuffer(undefined), 30);
  assert.equal(normalizeTravelBuffer(45), 45);
  assert.equal(normalizeTravelBuffer(181), 30);
  assert.equal(travelStartTime('11:00:00', 30), '10:30:00');
  assert.equal(travelStartTime('00:15:00', 30), '00:00:00');
  assert.equal(travelLaborCost(30, 40), 20);
  assert.equal(travelLaborCost(45, null), null);
  const ranked = [
    {
      technicianId: 1,
      dailyJobs: 0,
      proximity: { rank: 1 },
      travelPlan: { estimatedLaborCost: 20 },
    },
    {
      technicianId: 2,
      dailyJobs: 1,
      proximity: { rank: 1 },
      travelPlan: { estimatedLaborCost: 15 },
    },
  ].sort(compareDispatchCandidates);
  assert.deepEqual(
    ranked.map((row) => row.technicianId),
    [2, 1],
  );
});

test('new-request confirmation deadlines default to 48 hours and support bounded configuration', () => {
  const old = process.env.BOOKING_CONFIRMATION_HOURS;
  try {
    delete process.env.BOOKING_CONFIRMATION_HOURS;
    assert.equal(
      bookingExpiryDate(new Date('2026-09-24T02:30:00Z')),
      '2026-09-26 02:30:00',
    );
    process.env.BOOKING_CONFIRMATION_HOURS = '24';
    assert.equal(
      bookingExpiryDate(new Date('2026-09-24T02:30:00Z')),
      '2026-09-25 02:30:00',
    );
    process.env.BOOKING_CONFIRMATION_HOURS = '-1';
    assert.equal(
      bookingExpiryDate(new Date('2026-09-24T02:30:00Z')),
      '2026-09-26 02:30:00',
    );
  } finally {
    if (old === undefined) delete process.env.BOOKING_CONFIRMATION_HOURS;
    else process.env.BOOKING_CONFIRMATION_HOURS = old;
  }
});
