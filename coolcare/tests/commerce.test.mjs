import test from 'node:test';
import assert from 'node:assert/strict';
import { earnedPoints, safeCsv, paymentSchema, reportFilterSchema } from '../server/commerce.mjs';

test('reward earning floors cumulative net payment and never grants points on refunds beyond zero', () => {
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
test('payment schema requires positive exact cents, explanation and a valid date', () => {
  const valid = { requestId: '514934db-a145-430e-a57b-ad448e063353', kind: 'Receipt', amount: 50.01, method: 'PayNow', receivedDate: '2026-10-20', notes: 'Customer paid after service.' };
  assert.equal(paymentSchema.parse(valid).reference, '');
  for (const patch of [{ amount: 0 }, { amount: 1.001 }, { amount: -5 }, { receivedDate: '2026-02-30' }, { notes: '' }, { unexpected: 'field' }]) assert.throws(() => paymentSchema.parse({ ...valid, ...patch }));
});
test('report filter validates calendar dates, finite window and numeric IDs', () => {
  assert.equal(reportFilterSchema.parse({ from: '2026-10-01', to: '2026-10-31', serviceId: '1' }).serviceId, 1);
  assert.throws(() => reportFilterSchema.parse({ from: '2026-10-31', to: '2026-10-01' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2024-01-01', to: '2026-10-01' }));
  assert.throws(() => reportFilterSchema.parse({ from: '2026-02-30', to: '2026-03-02' }));
});
