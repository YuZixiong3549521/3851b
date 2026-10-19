import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell } from '../server/admin-workspace.mjs';

test('operation-log CSV escapes quotes and neutralizes spreadsheet formulas', () => {
  assert.equal(csvCell('A "quoted" name'), '"A ""quoted"" name"');
  for (const value of ['=1+1', '+1', '-2', '@SUM(A1)', '  =1'])
    assert.ok(csvCell(value).startsWith('"\''));
});
