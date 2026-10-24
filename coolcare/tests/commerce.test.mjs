import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedPoints, safeCsv, completionRedemption, reportFilterSchema } from '../server/commerce.mjs';
import { groupServicePeriods } from '../server/report-periods.mjs';

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
  assert.equal(reportFilterSchema.parse({ from: '2024-01-01', to: '2026-10-01', groupBy: 'year' }).groupBy, 'year');
  assert.throws(() => reportFilterSchema.parse({ from: '2020-01-01', to: '2026-10-01' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2026-01-01', to: '2026-10-01', groupBy: 'invalid' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2026-02-30', to: '2026-03-02' }));
  assert.equal(reportFilterSchema.parse({ from: '2026-10-01', to: '2026-10-31', serviceGroup: 'annual' }).serviceGroup, 'annual');
  assert.throws(() => reportFilterSchema.parse({ from: '2026-10-01', to: '2026-10-31', serviceId: 1, serviceGroup: 'annual' }));
});

test('service period grouping separates quarters and years while preserving exact amounts', () => {
  const daily = [
    { date: '2025-12-31', completed: 1, serviceAmount: 20.10, rewardDiscounts: 5, netServiceAmount: 15.10 },
    { date: '2026-01-01', completed: 2, serviceAmount: 100.20, rewardDiscounts: 10, netServiceAmount: 90.20 },
    { date: '2026-03-31', completed: 1, serviceAmount: 50.10, rewardDiscounts: 0, netServiceAmount: 50.10 },
    { date: '2026-04-01', completed: 1, serviceAmount: 30, rewardDiscounts: 5, netServiceAmount: 25 },
  ];
  const quarters = groupServicePeriods(daily, 'quarter');
  assert.deepEqual(quarters.map(r => r.period), ['2025-Q4', '2026-Q1', '2026-Q2']);
  assert.deepEqual(quarters[1], { period: '2026-Q1', completed: 3, serviceAmount: 150.30, rewardDiscounts: 10, netServiceAmount: 140.30 });
  const years = groupServicePeriods(daily, 'year');
  assert.deepEqual(years[1], { period: '2026', completed: 4, serviceAmount: 180.30, rewardDiscounts: 15, netServiceAmount: 165.30 });
  assert.equal(groupServicePeriods(daily).length, 4);
  assert.deepEqual(groupServicePeriods([], 'year'), []);
});
