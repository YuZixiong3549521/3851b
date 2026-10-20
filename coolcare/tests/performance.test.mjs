import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  punctualityScore,
  summarizePerformance,
  feedbackSchema,
  qualitySchema,
  settingsSchema,
} from '../server/performance.mjs';
const settings = {
  customerWeight: 40,
  qualityWeight: 40,
  punctualityWeight: 20,
  graceMinutes: 15,
};
const visit = {
  actualEnd: '2026-10-20 10:00:00',
  actualStart: '2026-10-20 09:15:00',
  scheduledStart: '2026-10-20 09:00:00',
  stars: 5,
  qualityScore: 80,
  outcome: 'Completed',
  reportSubmittedAt: '2026-10-20 10:01:00',
  checklistRecorded: true,
};
test('service start punctuality uses Singapore times, inclusive grace, and preserves unknown legacy times', () => {
  assert.equal(punctualityScore(visit, settings), 100);
  assert.equal(
    punctualityScore(
      { ...visit, actualStart: '2026-10-20 09:15:01' },
      settings,
    ),
    0,
  );
  assert.equal(
    punctualityScore(
      { ...visit, actualStart: '2026-10-20 08:55:00' },
      settings,
    ),
    100,
  );
  assert.equal(
    punctualityScore({ ...visit, scheduledStart: null }, settings),
    null,
  );
  assert.equal(
    punctualityScore({ ...visit, actualStart: null }, settings),
    null,
  );
});
test('headline composite requires five fully scored visits; missing values are not zero or reweighted', () => {
  const four = summarizePerformance(Array(4).fill(visit), settings);
  assert.equal(four.compositeScore, null);
  assert.equal(four.fullyScoredVisits, 4);
  const five = summarizePerformance(
    [
      ...Array(5).fill(visit),
      { ...visit, stars: null },
      { ...visit, qualityScore: null },
      { ...visit, scheduledStart: null },
    ],
    settings,
  );
  assert.equal(five.compositeScore, 92);
  assert.equal(five.fullyScoredVisits, 5);
  assert.equal(five.closedVisits, 8);
  assert.equal(five.customerAverage, 5);
  assert.equal(five.customerCount, 7);
  assert.equal(five.qualityAverage, 80);
  assert.equal(five.qualityCount, 7);
  assert.equal(five.punctualityCount, 7);
});
test('returns, unfinished reports and extensions give context and never independently deduct scores', () => {
  const visits = Array(5).fill({
    ...visit,
    outcome: 'Return required',
    reportSubmittedAt: null,
    checklistRecorded: false,
    extensionMinutes: 60,
  });
  const result = summarizePerformance(visits, settings);
  assert.equal(result.compositeScore, 92);
  assert.equal(result.returnRequiredVisits, 5);
  assert.equal(result.completedVisits, 0);
  assert.equal(result.reportsSubmitted, 0);
  assert.equal(result.checklistsRecorded, 0);
  const empty = summarizePerformance([{ ...visit, actualEnd: null }], settings);
  assert.equal(empty.closedVisits, 0);
  assert.equal(empty.customerAverage, null);
  assert.equal(empty.punctualityPercent, null);
});
test('assessment schemas require a real scale, explanatory admin reason and complete weights', () => {
  const base = { requestId: randomUUID(), expectedVersion: 0 };
  assert.ok(
    feedbackSchema.safeParse({ ...base, stars: 1, comment: '' }).success,
  );
  assert.equal(feedbackSchema.safeParse({ ...base, stars: 0 }).success, false);
  assert.equal(feedbackSchema.safeParse({ ...base, stars: 6 }).success, false);
  assert.equal(
    qualitySchema.safeParse({ ...base, score: 80, reason: '' }).success,
    false,
  );
  assert.equal(
    qualitySchema.safeParse({ ...base, score: 101, reason: 'Quality reviewed' })
      .success,
    false,
  );
  assert.ok(
    settingsSchema.safeParse({
      ...base,
      ...settings,
      reason: 'Agreed score policy',
    }).success,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...base,
      ...settings,
      customerWeight: 50,
      reason: 'Agreed score policy',
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...base,
      ...settings,
      graceMinutes: 61,
      reason: 'Agreed score policy',
    }).success,
    false,
  );
});
