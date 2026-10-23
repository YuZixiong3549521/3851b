import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../lib/booking-rewards.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { bookingRewardPreview } = await import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
const rules = { redemptionPoints: 100, redemptionValue: 5 };

test('booking rewards use whole blocks and cap the discount by the visit price and spendable wallet', () => {
  assert.deepEqual(bookingRewardPreview(50, 260, 200, rules), { maxPoints: 200, valid: true, discount: 10, netAmount: 40 });
  assert.deepEqual(bookingRewardPreview(50, 5000, 1000, rules), { maxPoints: 1000, valid: true, discount: 50, netAmount: 0 });
  assert.equal(bookingRewardPreview(50, -100, 0, rules).maxPoints, 0);
  assert.equal(bookingRewardPreview(3, 500, 0, rules).maxPoints, 0);
});

test('booking rewards reject invalid amounts and stale selections without silently changing the requested points', () => {
  for (const points of [-100, 1, 99, 100.5, 300, Infinity, NaN]) {
    const result = bookingRewardPreview(50, 200, points, rules);
    assert.equal(result.valid, false);
    assert.equal(result.discount, 0);
  }
  assert.equal(bookingRewardPreview(5, 1000, 200, rules).valid, false);
  assert.equal(bookingRewardPreview(50, 1000, 100, { redemptionPoints: 200, redemptionValue: 5 }).valid, false);
});

test('booking rewards calculate currency in cents including a full fractional-price discount', () => {
  assert.deepEqual(bookingRewardPreview(0.30, 30, 30, { redemptionPoints: 10, redemptionValue: 0.10 }), { maxPoints: 30, valid: true, discount: 0.3, netAmount: 0 });
  assert.deepEqual(bookingRewardPreview(5.99, 5000, 100, rules), { maxPoints: 100, valid: true, discount: 5, netAmount: 0.99 });
});
