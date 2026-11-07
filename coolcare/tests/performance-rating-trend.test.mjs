import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRatingTrends } from '../server/rating-trend.mjs';

const visit = (reportId, date, stars, extra = {}) => ({ reportId, technicianId: 7, technician: 'Alex Tan', actualEnd: date && `${date} 00:15:00`, outcome: 'Completed', stars, ...extra });

test('rating trends keep one current review per captured technician and completed visit', () => {
  const rows = [visit(1, '2026-01-01', 2), visit(1, '2026-01-01', 5),
    visit(1, '2026-01-01', 5, { technicianId: 8, technician: 'Lee Lim' }), visit(2, '2026-01-02', 3),
    visit(3, '2026-01-03', 1), visit(4, '2026-01-04', null), visit(5, '2026-01-05', 5, { outcome: 'Return required' })];
  const [alex, lee] = buildRatingTrends(rows, { from: '2026-01-01', to: '2026-01-31' });
  assert.equal(alex.count, 3);
  assert.equal(alex.average, 3);
  assert.deepEqual([alex.periods.month[0].positive, alex.periods.month[0].neutral, alex.periods.month[0].negative], [1, 1, 1]);
  assert.equal(lee.count, 1);
  assert.equal(lee.average, 5);
});

test('month, quarter and year charts use rating-weighted averages and preserve missing periods as null', () => {
  const [trend] = buildRatingTrends([visit(1, '2025-12-31', 1), visit(2, '2026-01-01', 5),
    visit(3, '2026-01-10', 4), visit(4, '2026-03-10', 3)], { from: '2025-12-15', to: '2026-04-10' });
  assert.equal(trend.average, 3.25);
  assert.deepEqual(trend.periods.month.map(row => [row.period, row.count, row.average]), [
    ['2025-12', 1, 1], ['2026-01', 2, 4.5], ['2026-02', 0, null], ['2026-03', 1, 3], ['2026-04', 0, null],
  ]);
  assert.deepEqual(trend.periods.quarter.map(row => [row.period, row.count, row.average]), [
    ['2025-Q4', 1, 1], ['2026-Q1', 3, 4], ['2026-Q2', 0, null],
  ]);
  assert.deepEqual(trend.periods.year.map(row => [row.period, row.count, row.average]), [['2025', 1, 1], ['2026', 3, 4]]);
  assert.equal(trend.periods.month[0].partial, true);
  assert.equal(trend.periods.month[0].from, '2025-12-15');
  assert.equal(trend.periods.month[1].partial, false);
  assert.equal(trend.periods.month.at(-1).to, '2026-04-10');
});

test('completion dates use captured Singapore calendar dates and reject unknown, invalid and out-of-range visits', () => {
  const [trend] = buildRatingTrends([visit(1, '2026-04-01', 4), visit(2, '2026-03-31', 1),
    visit(3, null, 5), visit(4, '2026-02-31', 5), visit(5, '2026-05-01', 5), visit(6, '2026-04-20', 0),
    visit(7, '2026-04-21', 6), visit(8, '2026-04-22', 2.5)], { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(trend.count, 1);
  assert.equal(trend.periods.quarter[0].period, '2026-Q2');
  assert.equal(trend.average, 4);
  const [unrated] = buildRatingTrends([visit(9, '2026-04-02', null)], { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(unrated.count, 0);
  assert.equal(unrated.average, null);
  assert.equal(unrated.periods.month[0].average, null);
  assert.deepEqual(buildRatingTrends([], { from: '2026-04-01', to: '2026-04-30' }), []);
});

test('direction requires at least three reviews in each calendar half and does not imply a prediction', () => {
  const range = { from: '2026-01-01', to: '2026-01-31' };
  const earlier = [visit(1, '2026-01-01', 3), visit(2, '2026-01-15', 3), visit(3, '2026-01-16', 3)];
  const later = [visit(4, '2026-01-17', 4), visit(5, '2026-01-20', 4), visit(6, '2026-01-31', 4)];
  const comparison = buildRatingTrends([...earlier, ...later], range)[0].comparison;
  assert.equal(comparison.earlier.to, '2026-01-16');
  assert.equal(comparison.later.from, '2026-01-17');
  assert.equal(comparison.direction, 'higher');
  assert.equal(comparison.difference, 1);
  assert.equal(buildRatingTrends([...earlier, ...later.slice(0, 2)], range)[0].comparison.direction, 'insufficient');
  assert.equal(buildRatingTrends([...earlier, ...later.map(row => ({ ...row, stars: 2 }))], range)[0].comparison.direction, 'lower');
  assert.equal(buildRatingTrends([...earlier, ...later.map(row => ({ ...row, stars: 3 }))], range)[0].comparison.direction, 'unchanged');
  const single = buildRatingTrends(earlier, { from: '2026-01-01', to: '2026-01-01' })[0].comparison;
  assert.equal(single.direction, 'insufficient');
  assert.equal(single.later.from, null);
});
