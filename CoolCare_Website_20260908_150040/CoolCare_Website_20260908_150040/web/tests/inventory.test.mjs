import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  partSchema,
  editPartSchema,
  transactionSchema,
  stockDelta,
  projectedStock,
  toCsv,
} from '../server/inventory.mjs';

test('part validation trims names, accepts zero price, and rejects stock edits', () => {
  assert.equal(
    partSchema.parse({
      part_name: ' Filter ',
      unit_price: '0.00',
      status: 'Active',
    }).part_name,
    'Filter',
  );
  for (const price of ['-1', '1.234', '1e4', 'NaN', '100000000'])
    assert.equal(
      partSchema.safeParse({
        part_name: 'Filter',
        unit_price: price,
        status: 'Active',
      }).success,
      false,
    );
  assert.equal(
    partSchema.safeParse({
      part_name: 'Filter',
      unit_price: '2.00',
      status: 'Active',
      current_stock: 999,
    }).success,
    false,
  );
  assert.equal(
    editPartSchema.safeParse({
      part_name: 'Filter',
      unit_price: '2',
      status: 'Active',
    }).success,
    false,
  );
});
const base = {
  request_id: randomUUID(),
  part_id: 1,
  transaction_type: 'Stock Out',
  quantity: 5,
  expected_stock: 25,
};
test('quantity and direction validation', () => {
  assert.equal(stockDelta(transactionSchema.parse(base)), -5);
  for (const quantity of [0, -1, 1.5, 2147483648])
    assert.equal(
      transactionSchema.safeParse({ ...base, quantity }).success,
      false,
    );
  assert.equal(
    transactionSchema.safeParse({ ...base, transaction_type: 'Adjustment' })
      .success,
    false,
  );
  assert.equal(
    stockDelta(
      transactionSchema.parse({
        ...base,
        transaction_type: 'Adjustment',
        direction: 'Decrease',
        remarks: 'Damaged unit',
      }),
    ),
    -5,
  );
  assert.equal(
    stockDelta(
      transactionSchema.parse({ ...base, transaction_type: 'Return' }),
    ),
    5,
  );
});
test('stock never becomes negative or overflows', () => {
  assert.equal(projectedStock(25, -5), 20);
  assert.equal(projectedStock(5, -5), 0);
  assert.throws(() => projectedStock(4, -5));
  assert.throws(() => projectedStock(2147483647, 1));
});
test('CSV quotes strings and protects spreadsheet formula injection', () => {
  const result = toCsv(
    ['Name', 'Remarks'],
    [
      ['A, "B"', '=1+1'],
      ['safe', ' @SUM(A1)'],
    ],
  );
  assert.ok(result.includes('"A, ""B"""'));
  assert.ok(result.includes('"\'=1+1"'));
  assert.ok(result.includes('"\' @SUM(A1)"'));
});
