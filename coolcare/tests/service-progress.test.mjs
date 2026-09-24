import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  serviceProgressSchema,
  extendTime,
} from '../server/service-progress.mjs';
const base = {
  requestId: randomUUID(),
  expectedVersion: 0,
  notes: 'Actual service work recorded',
};
test('service progress accepts structured quotes and rejects negative, imprecise or unbounded charges', () => {
  assert.equal(
    serviceProgressSchema.parse({
      ...base,
      action: 'repair-quote',
      amount: 49.5,
    }).amount,
    49.5,
  );
  for (const amount of [-1, 0.001, 100001, Infinity])
    assert.equal(
      serviceProgressSchema.safeParse({
        ...base,
        action: 'repair-quote',
        amount,
      }).success,
      false,
    );
});
test('extensions use real 15-minute increments and cannot silently go beyond operating hours', () => {
  assert.equal(extendTime('11:15:00', 45), '12:00:00');
  assert.equal(extendTime('17:30:00', 30), '18:00:00');
  assert.throws(() => extendTime('17:30:00', 45), /return visit/);
  for (const minutes of [0, 14, 16, 135])
    assert.equal(
      serviceProgressSchema.safeParse({
        ...base,
        action: 'extend',
        minutes,
        reason: 'Other',
      }).success,
      false,
    );
});
test('return updates require content and do not accept an arbitrary technician or job identity', () => {
  assert.equal(
    serviceProgressSchema.safeParse({
      ...base,
      action: 'require-return',
      reason: 'Part unavailable',
      partNotes: 'Fan motor, 1 unit',
    }).success,
    true,
  );
  assert.equal(
    serviceProgressSchema.safeParse({
      ...base,
      action: 'complete-return',
      technicianId: 1,
    }).success,
    false,
  );
  assert.equal(
    serviceProgressSchema.safeParse({
      ...base,
      action: 'start-return',
      notes: '',
    }).success,
    false,
  );
});
