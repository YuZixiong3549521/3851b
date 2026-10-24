import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedPoints, safeCsv, completionRedemption, reportFilterSchema } from '../server/commerce.mjs';
import { buildReportAnalytics, classifyReportService, groupServicePeriods } from '../server/report-periods.mjs';

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

test('report service categories use catalogue codes and annual visit identity without double counting', () => {
  assert.equal(classifyReportService(true, 'cleaning,repair'), 'annual');
  assert.equal(classifyReportService(false, 'repair,cleaning,cleaning'), 'combined');
  assert.equal(classifyReportService(false, 'cleaning'), 'cleaning');
  assert.equal(classifyReportService(false, 'repair'), 'repair');
  assert.equal(classifyReportService(false, 'cleaning,other'), 'other');
  assert.equal(classifyReportService(false, 'Chemical Cleaning'), 'other');
  assert.equal(classifyReportService(false, null), 'other');
});

test('analytics fills empty quarters and flags clipped calendar periods across year boundaries', () => {
  const { periods } = buildReportAnalytics([], { from: '2024-03-15', to: '2025-02-01', groupBy: 'quarter' });
  assert.deepEqual(periods.map(p => p.period), ['2024-Q1', '2024-Q2', '2024-Q3', '2024-Q4', '2025-Q1']);
  assert.deepEqual(periods.map(p => [p.from, p.to, p.partial]), [
    ['2024-03-15', '2024-03-31', true], ['2024-04-01', '2024-06-30', false],
    ['2024-07-01', '2024-09-30', false], ['2024-10-01', '2024-12-31', false],
    ['2025-01-01', '2025-02-01', true],
  ]);
  assert.ok(periods.every(p => p.orders === 0 && p.serviceAmount === 0 && p.annual.visits === 0));
  const years = buildReportAnalytics([], { from: '2024-01-01', to: '2025-12-31', groupBy: 'year' }).periods;
  assert.deepEqual(years.map(p => [p.period, p.partial]), [['2024', false], ['2025', false]]);
});

test('daily analytics includes leap day and inclusive end dates without host-timezone shifts', () => {
  const { periods } = buildReportAnalytics([], { from: '2024-02-28', to: '2024-03-01', groupBy: 'day' });
  assert.deepEqual(periods.map(p => p.period), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.ok(periods.every(p => p.from === p.to && !p.partial));
  const one = buildReportAnalytics([], { from: '2026-12-31', to: '2026-12-31', groupBy: 'year' }).periods;
  assert.deepEqual(one.map(p => [p.period, p.from, p.to, p.partial]), [['2026', '2026-12-31', '2026-12-31', true]]);
});

test('analytics counts current order states once, preserves exact completed money and marks unknown prices', () => {
  const base = { serviceDate: '2026-01-01', serviceGroup: 'cleaning', isAnnual: false, serviceAmount: 0, rewardDiscount: 0, netServiceAmount: 0 };
  const orders = [
    { ...base, status: 'Completed', serviceGroup: 'combined', serviceAmount: 100.20, rewardDiscount: 5, netServiceAmount: 95.20, visits: 3, returns: 2 },
    { ...base, status: 'Completed', isAnnual: true, serviceGroup: 'annual', serviceAmount: 0.10, netServiceAmount: 0.10 },
    { ...base, status: 'Completed', serviceGroup: 'other', serviceAmount: null, netServiceAmount: null },
    ...['Submitted', 'Confirmed', 'Assigned', 'On The Way', 'In Progress', 'Awaiting return arrangement', 'Return visit'].map(status => ({ ...base, status, serviceAmount: 500, isAnnual: true, serviceGroup: 'annual' })),
    ...['Cancelled', 'Rejected', 'Expired'].map(status => ({ ...base, status, isAnnual: true, serviceGroup: 'annual' })),
    { ...base, status: 'Legacy unknown', isAnnual: true, serviceGroup: 'annual' },
    { ...base, status: 'Completed', serviceDate: '2025-12-31', serviceAmount: 999 },
  ];
  const [row] = buildReportAnalytics(orders, { from: '2026-01-01', to: '2026-03-31', groupBy: 'quarter' }).periods;
  assert.equal(row.orders, 14);
  assert.equal(row.completed, 3);
  assert.equal(row.active, 7);
  assert.equal(row.closed, 3);
  assert.equal(row.other, 1);
  assert.equal(row.unknownCompletedPrices, 1);
  assert.equal(row.serviceAmount, 100.30);
  assert.equal(row.rewardDiscounts, 5);
  assert.equal(row.netServiceAmount, 95.30);
  assert.deepEqual(row.services, { cleaning: 0, repair: 0, combined: 1, annual: 12, other: 1 });
  assert.deepEqual(row.annual, { visits: 12, completed: 1, active: 7, closed: 3, other: 1 });
  assert.equal(Object.values(row.services).reduce((sum, n) => sum + n, 0), row.orders);
});
