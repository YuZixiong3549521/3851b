import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedPoints, safeCsv, completionRedemption, reportFilterSchema } from '../server/commerce.mjs';

test('reward earning floors the net completed service value and never grants negative points', () => {
  assert.equal(earnedPoints(199, 1), 1);
  assert.equal(earnedPoints(200, 1), 2);
  assert.equal(earnedPoints(0, 1), 0);
  assert.equal(earnedPoints(-100, 1), 0);
  assert.equal(earnedPoints(12345, 2), 246);
  assert.equal(earnedPoints(5000, 0), 0);
});
test('CSV neutralises formulas including whitespace prefixes and preserves quoting/newlines', () => {
  const csv = safeCsv([['=HYPERLINK("bad")', ' \t+SUM(1)', '@formula', '-2', 'normal "quoted"\nvalue']]);
  assert.ok(csv.includes(`"'=HYPERLINK(""bad"")"`));
  assert.ok(csv.includes(`"' \t+SUM(1)"`));
  assert.ok(csv.includes(`"'@formula"`));
  assert.ok(csv.includes(`"'-2"`));
  assert.ok(csv.includes('"normal ""quoted""\nvalue"'));
});
test('completion redemption supports full discounts and protects other reservations in whole blocks', () => {
  const input = { quoteCents: 5000, balance: 1000, otherReserved: 0, points: 1000, blockPoints: 100, blockValueCents: 500 };
  assert.deepEqual(completionRedemption(input), { points: 1000, discountCents: 5000 });
  assert.deepEqual(completionRedemption({ ...input, balance: 250, otherReserved: 100, points: 200 }), { points: 100, discountCents: 500 });
  assert.deepEqual(completionRedemption({ ...input, quoteCents: 300 }), { points: 0, discountCents: 0 });
  assert.deepEqual(completionRedemption({ ...input, quoteCents: null }), { points: 0, discountCents: 0 });
  assert.deepEqual(completionRedemption({ ...input, balance: -100 }), { points: 0, discountCents: 0 });
});
test('report filter validates calendar dates, finite window and numeric IDs', () => {
  assert.equal(reportFilterSchema.parse({ from: '2026-10-01', to: '2026-10-31', serviceId: '1' }).serviceId, 1);
  assert.throws(() => reportFilterSchema.parse({ from: '2026-10-31', to: '2026-10-01' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2024-01-01', to: '2026-10-01' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2026-02-30', to: '2026-03-02' }));
});
